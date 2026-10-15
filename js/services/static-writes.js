import { execute } from "../../core/engine.mjs";
const timeKeys = new Set([
  "createdAt",
  "updatedAt",
  "completedAt",
  "verifiedAt",
  "resolvedAt",
  "purchasedAt",
  "archivedAt",
  "actualTime",
  "snapshotAt",
]);
function normalize(value) {
  if (value?.toMillis) return value.toMillis();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, normalize(v)]),
    );
  return value;
}
function serialize(data, now, sdk) {
  const copy = { ...data };
  for (const key of Object.keys(copy)) {
    if (timeKeys.has(key) && typeof copy[key] === "number")
      copy[key] =
        copy[key] === now
          ? sdk.serverTimestamp()
          : sdk.Timestamp.fromMillis(copy[key]);
    if (key === "expiresAt" && typeof copy[key] === "number")
      copy[key] = sdk.Timestamp.fromMillis(copy[key]);
  }
  if (copy.rates)
    copy.rates = Object.fromEntries(
      Object.entries(copy.rates).map(([uid, rate]) => [
        uid,
        {
          ...rate,
          at:
            rate.at === now
              ? sdk.serverTimestamp()
              : sdk.Timestamp.fromMillis(rate.at),
        },
      ]),
    );
  return copy;
}
export async function staticOperate(sdk, user, command, attempt = 0) {
  if (command.op === "setlistPerform") {
    const snap = await sdk.getDoc(
      sdk.doc(sdk.db, `events/${command.eventId}/setlists/${command.id}`),
    );
    command = {
      ...command,
      songIndex: (snap.data()?.songs || []).findIndex(
        (song) => song.id === command.songId,
      ),
    };
  }
  // Server-generated clock anchors quota windows and expiry; operational timestamps use serverTimestamp at commit.
  const clock = sdk.doc(
    sdk.db,
    "clientClock",
    user.id + "_" + command.requestId,
  );
  await sdk.setDoc(clock, { at: sdk.serverTimestamp() });
  const clockSnap = await sdk.getDocFromServer(clock);
  const now = clockSnap.data().at.toMillis();
  try {
    return await sdk.runTransaction(sdk.db, async (transaction) => {
      const staged = new Map(),
        originals = new Map(),
        read = new Map();
      const get = async (path) => {
        if (staged.has(path)) return staged.get(path);
        if (read.has(path)) return read.get(path);
        const snap = await transaction.get(sdk.doc(sdk.db, path));
        const value = snap.exists() ? normalize(snap.data()) : null;
        read.set(path, value);
        originals.set(path, snap.exists() ? snap.data() : null);
        return value;
      };
      const adapter = {
        get,
        async query(path, filters = []) {
          if (
            path === "users" &&
            filters.length === 1 &&
            filters[0][0] === "crewId"
          ) {
            const link = await get(`accountLinks/${filters[0][2]}`);
            return link?.uid
              ? [
                  {
                    id: link.uid,
                    crewId: filters[0][2],
                    active: link.active,
                    permissions: { "events.write": !!link.eventManager },
                  },
                ]
              : [];
          }
          let effective = [...filters];
          if (
            path === "maintenance" &&
            !user.owner &&
            !user.permissions?.["operations.read"] &&
            command.eventId
          )
            effective.push(["eventId", "==", command.eventId]);
          const q = sdk.query(
            sdk.collection(sdk.db, path),
            ...effective.map(([f, o, v]) => sdk.where(f, o, v)),
            sdk.limit(401),
          );
          const snapshot = await sdk.getDocs(q);
          if (snapshot.size > 400)
            throw Error(
              "This operation spans more than 400 related records. Split it into smaller batches.",
            );
          const rows = new Map();
          for (const doc of snapshot.docs) {
            const value = await get(`${path}/${doc.id}`);
            if (value) rows.set(doc.id, { id: doc.id, ...value });
          }
          for (const [key, value] of staged) {
            if (key.slice(0, key.lastIndexOf("/")) !== path) continue;
            const keyId = key.split("/").at(-1);
            if (
              value &&
              effective.every(([f, o, v]) =>
                o === "=="
                  ? value[f] === v
                  : o === "array-contains"
                    ? value[f]?.includes(v)
                    : false,
              )
            )
              rows.set(keyId, { id: keyId, ...value });
            else rows.delete(keyId);
          }
          return [...rows.values()];
        },
        set(path, data) {
          const copy = { ...data };
          delete copy.id;
          staged.set(path, copy);
        },
        delete(path) {
          staged.set(path, null);
        },
      };
      const accessVersion = ["member", "role"].includes(command.op)
        ? await get("accessControl/version")
        : null;
      const output = await execute(adapter, user.id, command, {
        now: () => now,
        randomId: () => crypto.randomUUID().replaceAll("-", ""),
        staticClient: true,
      });
      if (["member", "role"].includes(command.op))
        adapter.set("accessControl/version", {
          revision: (accessVersion?.revision || 0) + 1,
          updatedAt: now,
        });
      for (const [path, value] of [...staged])
        if (
          path.startsWith("users/") &&
          value &&
          ["member", "role"].includes(command.op)
        ) {
          const uid = path.split("/")[1],
            old = read.get(path);
          if (old?.crewId && old.crewId !== value.crewId) {
            const link = await get(`accountLinks/${old.crewId}`);
            if (link?.uid === uid) adapter.delete(`accountLinks/${old.crewId}`);
          }
          if (value.crewId)
            adapter.set(`accountLinks/${value.crewId}`, {
              uid,
              crewId: value.crewId,
              active: value.active,
              eventManager: !!(
                value.owner || value.permissions?.["events.write"]
              ),
              updatedAt: now,
            });
        }
      // All mutations remain atomic; large operations fail without partly applying.
      if (staged.size > 450)
        throw Error(
          "This operation is too large for one transaction. Split it into smaller batches.",
        );
      if (!staged.size) return output;
      const encoded = new Map(
        [...staged].map(([path, value]) => [
          path,
          value === null
            ? null
            : serialize(
                {
                  ...value,
                  clientMutationId: command.requestId,
                  ...(/^(activityLogs|financeActivityLogs|privateActivityLogs)\//.test(
                    path,
                  )
                    ? { source: "static-client" }
                    : {}),
                },
                now,
                sdk,
              ),
        ]),
      );
      const auditPath = [...encoded.keys()].find((path) =>
        /^(activityLogs|financeActivityLogs|privateActivityLogs)\//.test(path),
      );
      const proof = {};
      for (const [path, value] of encoded)
        if (
          !/^(activityLogs|financeActivityLogs|privateActivityLogs)\//.test(
            path,
          ) &&
          !path.startsWith("requests/")
        )
          proof[path] = { before: originals.get(path) || null, after: value };
      if (JSON.stringify(proof).length > 700000)
        throw Error(
          "This operation contains too much data for one atomic transaction. Export or reduce oversized notes first.",
        );
      transaction.set(sdk.doc(sdk.db, "clientMutations", command.requestId), {
        uid: user.id,
        command,
        result: output,
        auditId: auditPath?.split("/").at(-1) || null,
        auditCollection: auditPath?.split("/")[0] || "activityLogs",
        recordChanges: proof,
        createdAt: sdk.serverTimestamp(),
      });
      for (const [path, value] of encoded) {
        if (value === null) transaction.delete(sdk.doc(sdk.db, path));
        else transaction.set(sdk.doc(sdk.db, path), value);
      }
      return output;
    });
  } catch (error) {
    if (error.code === "permission-denied" && attempt === 0)
      return staticOperate(sdk, user, command, 1);
    throw error;
  }
}
