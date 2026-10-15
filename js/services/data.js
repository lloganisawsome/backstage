import {
  scopeFirestore,
  ensureOwnerMembership,
  backstageAppName,
} from "../../core/firebase-scope.mjs";
import { execute } from "../../core/engine.mjs";
import { roleDefaults, permitted } from "../../core/schema.mjs";
import { firebaseConfig, useEmulators } from "../config.js";
let local = false,
  fb = null,
  db = null,
  user = null,
  authUser = null,
  change = new EventTarget(),
  channel = null,
  offMembership = null;
const listeners = new Set();
export const session = () => ({ local, user, authUser });
export const changes = change;
export const can = (p) => permitted(user, p);
export async function connect() {
  if (fb) return;
  for (const key of ["apiKey", "authDomain", "projectId", "appId"])
    if (!firebaseConfig[key])
      throw Error("Missing Firebase configuration. Edit public/js/config.js.");
  const version = "12.19.0",
    root = `https://www.gstatic.com/firebasejs/${version}/`;
  const [app, auth, firestore] = await Promise.all(
    ["firebase-app.js", "firebase-auth.js", "firebase-firestore.js"].map(
      (x) => import(root + x),
    ),
  );
  const instance = app.initializeApp(firebaseConfig, backstageAppName);
  fb = {
    ...auth,
    ...scopeFirestore(firestore),
    auth: auth.getAuth(instance),
    db: firestore.getFirestore(instance),
  };
  if (useEmulators) {
    auth.connectAuthEmulator(fb.auth, "http://127.0.0.1:9099");
    firestore.connectFirestoreEmulator(fb.db, "127.0.0.1", 8080);
  }
  await auth.setPersistence(fb.auth, auth.browserSessionPersistence);
}
const normalize = (v) => {
  if (v?.toMillis) return v.toMillis();
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [k, normalize(x)]),
    );
  return v;
};
export async function login(email, password) {
  await connect();
  local = false;
  const result = await fb.signInWithEmailAndPassword(fb.auth, email, password);
  authUser = result.user;
  if (!authUser.emailVerified) {
    await fb.sendEmailVerification(authUser);
    throw Error("Check your email to verify this account, then sign in again.");
  }
  await loadMember();
}
export async function loginWithGoogle() {
  await connect();
  local = false;
  const result = await fb.signInWithPopup(fb.auth, new fb.GoogleAuthProvider());
  authUser = result.user;
  if (!authUser.emailVerified)
    throw Error("Verify your account email before accessing Backstage.");
  await loadMember();
}
export async function restore() {
  await connect();
  await new Promise((resolve) => {
    const off = fb.onAuthStateChanged(fb.auth, () => {
      off();
      resolve();
    });
  });
  authUser = fb.auth.currentUser;
  if (authUser?.emailVerified) {
    try {
      await loadMember();
      return true;
    } catch {
      await logout();
    }
  }
  return false;
}
async function loadMember() {
  await ensureOwnerMembership(fb, fb.db, authUser);
  const snap = await fb.getDoc(fb.doc(fb.db, "users", authUser.uid));
  if (!snap.exists() || !snap.data().active)
    throw Error(
      `Your account has no active Backstage membership. Ask the owner to provision UID ${authUser.uid}.`,
    );
  user = { id: authUser.uid, ...normalize(snap.data()) };
  offMembership?.();
  offMembership = fb.onSnapshot(snap.ref, (s) => {
    if (!s.exists() || !s.data().active) {
      logout();
      change.dispatchEvent(new Event("revoked"));
    } else {
      user = { id: authUser.uid, ...normalize(s.data()) };
      change.dispatchEvent(new Event("membership"));
    }
  });
}
export async function register(email, password) {
  await connect();
  const result = await fb.createUserWithEmailAndPassword(
    fb.auth,
    email,
    password,
  );
  await fb.sendEmailVerification(result.user);
  const uid = result.user.uid;
  await fb.signOut(fb.auth);
  return uid;
}
export async function reset(email) {
  await connect();
  await fb.sendPasswordResetEmail(fb.auth, email);
}
export async function logout() {
  offMembership?.();
  offMembership = null;
  clearListeners();
  if (fb?.auth?.currentUser) await fb.signOut(fb.auth);
  user = null;
  authUser = null;
  local = false;
  channel?.close();
  channel = null;
}
export async function localWorkspace() {
  clearListeners();
  local = true;
  db = await new Promise((resolve, reject) => {
    const req = indexedDB.open("backstage-local-v1", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("records");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const owner = {
    id: "local-owner",
    name: "Local workspace",
    active: true,
    owner: true,
    roles: ["Owner"],
    permissions: roleDefaults.Owner,
    revision: 1,
  };
  if (!(await localGet("users/local-owner"))) {
    await localSet("users/local-owner", owner);
    for (const [role, permissions] of Object.entries(roleDefaults))
      await localSet(
        `roles/${role === "Event Manager" ? "event-manager" : role}`,
        { name: role, permissions, revision: 1 },
      );
  }
  user = { ...(await localGet("users/local-owner")), id: "local-owner" };
  channel = new BroadcastChannel("backstage-local-v1");
  channel.onmessage = () => change.dispatchEvent(new Event("data"));
}
const localGet = (key) =>
  new Promise((resolve, reject) => {
    const tx = db.transaction("records"),
      request = tx.objectStore("records").get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
const localSet = (key, value) =>
  new Promise((resolve, reject) => {
    const tx = db.transaction("records", "readwrite");
    tx.objectStore("records").put(value, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
async function localAll() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("records"),
      s = tx.objectStore("records"),
      req = s.openCursor();
    const values = new Map();
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        values.set(cursor.key, cursor.value);
        cursor.continue();
      } else resolve(values);
    };
    req.onerror = () => reject(req.error);
  });
}
export async function get(path) {
  if (local) {
    const value = await localGet(path);
    return value ? { ...value, id: path.split("/").at(-1) } : null;
  }
  await connect();
  const snap = await fb.getDoc(fb.doc(fb.db, path));
  return snap.exists() ? { id: snap.id, ...normalize(snap.data()) } : null;
}
async function constraints(
  path,
  { filters = [], search = "", size = 50, cursor } = {},
) {
  const result = [...filters];
  if (path === "images" && can("equipment.write") && !can("crew.read"))
    result.push([
      "targetType",
      "in",
      ["equipment", "cases", "maintenance", "events"],
    ]);
  if (path === "events" && !can("operations.read"))
    result.push(["memberUids", "array-contains", user.id]);
  if (
    ["equipment", "cases", "maintenance", "images"].includes(path) &&
    !can("operations.read") &&
    !user.owner
  ) {
    const events = await list("events", { size: 30 });
    const eventIds = events.rows.map((e) => e.id);
    if (!eventIds.length) return null;
    result.push(["eventId", "in", eventIds]);
  }
  if (path === "notifications") result.push(["uid", "==", user.id]);
  return result;
}
export async function list(path, options = {}) {
  const { search = "", size = 50, cursor, order = "createdAt" } = options;
  if (
    search &&
    ["equipment", "cases", "crew"].includes(path) &&
    /^[A-Z0-9]+(?:-[A-Z0-9]+)+$/.test(search.toUpperCase())
  ) {
    try {
      const found = await operate({
          op: "lookupAsset",
          assetId: search.toUpperCase(),
          type: path,
        }),
        row = await get(`${path}/${found.id}`);
      return { rows: row ? [row] : [], hasMore: false };
    } catch (error) {
      if (error.message.includes("not found"))
        return { rows: [], hasMore: false };
      throw error;
    }
  }
  const filters = await constraints(path, options);
  if (filters === null) return { rows: [], hasMore: false };
  if (local) {
    const records = await localAll();
    let rows = [...records]
      .filter(
        ([key, value]) =>
          key.slice(0, key.lastIndexOf("/")) === path &&
          filters.every(([field, op, test]) =>
            op === "=="
              ? value[field] === test
              : op === "in"
                ? test.includes(value[field])
                : op === "array-contains"
                  ? value[field]?.includes(test)
                  : op === ">="
                    ? value[field] >= test
                    : op === "<="
                      ? value[field] <= test
                      : false,
          ),
      )
      .map(([key, value]) => ({ id: key.split("/").at(-1), ...value }));
    if (search)
      rows = rows.filter((r) =>
        (r.nameKey || r.name?.toLowerCase() || "").startsWith(
          search.toLowerCase(),
        ),
      );
    rows.sort((a, b) =>
      order === "nameKey"
        ? (a.nameKey || a.name || "").localeCompare(b.nameKey || b.name || "")
        : (b.createdAt || 0) - (a.createdAt || 0) || a.id.localeCompare(b.id),
    );
    const offset = cursor || 0;
    return {
      rows: rows.slice(offset, offset + size),
      cursor: offset + size,
      hasMore: rows.length > offset + size,
    };
  }
  await connect();
  const clauses = filters.map(([f, op, v]) => fb.where(f, op, v));
  if (search) {
    clauses.push(
      fb.orderBy("nameKey"),
      fb.startAt(search.toLowerCase()),
      fb.endAt(search.toLowerCase() + "\uf8ff"),
    );
  } else
    clauses.push(fb.orderBy(order, order === "createdAt" ? "desc" : "asc"));
  if (cursor) clauses.push(fb.startAfter(cursor));
  clauses.push(fb.limit(size + 1));
  const snap = await fb.getDocs(
    fb.query(fb.collection(fb.db, path), ...clauses),
  );
  const docs = snap.docs.slice(0, size);
  return {
    rows: docs.map((d) => ({ id: d.id, ...normalize(d.data()) })),
    cursor: docs.at(-1),
    hasMore: snap.size > size,
  };
}
export async function queryAll(path, filters = []) {
  const rows = [];
  let cursor;
  do {
    const page = await list(path, { filters, size: 100, cursor });
    rows.push(...page.rows);
    if (rows.length > 5000)
      throw Error("Export exceeds 5,000 records. Filter by event or category.");
    cursor = page.hasMore ? page.cursor : null;
  } while (cursor);
  return rows;
}
export function watch(path, callback, error = () => {}, options = {}) {
  let off = () => {};
  if (local) {
    const run = () =>
      list(path, { size: 200, ...options })
        .then((v) => callback(v.rows))
        .catch(error);
    run();
    change.addEventListener("data", run);
    off = () => change.removeEventListener("data", run);
  } else {
    let canceled = false;
    constraints(path, options)
      .then((filters) => {
        if (canceled) return;
        if (filters === null) {
          callback([]);
          return;
        }
        const q = fb.query(
          fb.collection(fb.db, path),
          ...filters.map(([f, o, v]) => fb.where(f, o, v)),
          fb.orderBy("createdAt", "desc"),
          fb.limit(options.size || 200),
        );
        const cancel = fb.onSnapshot(
          q,
          (s) =>
            callback(s.docs.map((d) => ({ id: d.id, ...normalize(d.data()) }))),
          error,
        );
        off = () => {
          canceled = true;
          cancel();
        };
      })
      .catch(error);
    off = () => {
      canceled = true;
    };
  }
  const cleanup = () => {
    off();
    listeners.delete(cleanup);
  };
  listeners.add(cleanup);
  return cleanup;
}
export function clearListeners() {
  for (const stop of [...listeners]) stop();
}
export async function operate(payload) {
  if (!navigator.onLine && !local)
    throw Error(
      "You are offline. Reconnect before updating shared records; no change has been synchronized.",
    );
  const request = {
    ...payload,
    requestId: payload.requestId || crypto.randomUUID().replaceAll("-", ""),
  };
  let result;
  if (local) {
    const run = async () => {
      const records = await localAll();
      const staged = new Map(records);
      const adapter = {
        get: async (p) => staged.get(p) || null,
        query: async (p, filters = []) =>
          [...staged]
            .filter(
              ([k, v]) =>
                k.slice(0, k.lastIndexOf("/")) === p &&
                filters.every(([f, o, t]) =>
                  o === "=="
                    ? v[f] === t
                    : o === "array-contains"
                      ? v[f]?.includes(t)
                      : false,
                ),
            )
            .map(([k, v]) => ({ id: k.split("/").at(-1), ...v })),
        set: (p, d) => {
          const value = { ...d };
          delete value.id;
          staged.set(p, value);
        },
        delete: (p) => staged.delete(p),
      };
      const output = await execute(adapter, user.id, request, {
        now: () => Date.now(),
        randomId: () => crypto.randomUUID().replaceAll("-", ""),
        staticClient: true,
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction("records", "readwrite"),
          store = tx.objectStore("records");
        for (const [key, value] of staged)
          if (JSON.stringify(records.get(key)) !== JSON.stringify(value))
            store.put(value, key);
        for (const key of records.keys())
          if (!staged.has(key)) store.delete(key);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      return output;
    };
    result = navigator.locks
      ? await navigator.locks.request("backstage-write", run)
      : await run();
    user = { ...(await localGet(`users/${user.id}`)), id: user.id };
    channel?.postMessage("changed");
    change.dispatchEvent(new Event("data"));
  } else {
    await connect();
    const { staticOperate } = await import("./static-writes.js");
    result = await staticOperate(fb, user, JSON.parse(JSON.stringify(request)));
  }
  return result;
}
export async function count(path, filters = []) {
  const rules = await constraints(path, { filters });
  if (rules === null) return 0;
  if (local) {
    const records = await localAll();
    return [...records].filter(
      ([k, v]) =>
        k.slice(0, k.lastIndexOf("/")) === path &&
        rules.every(([f, o, t]) =>
          o === "=="
            ? v[f] === t
            : o === "in"
              ? t.includes(v[f])
              : o === "array-contains"
                ? v[f]?.includes(t)
                : o === ">="
                  ? v[f] >= t
                  : false,
        ),
    ).length;
  }
  const q = fb.query(
    fb.collection(fb.db, path),
    ...rules.map(([f, o, v]) => fb.where(f, o, v)),
  );
  return (await fb.getCountFromServer(q)).data().count;
}

export async function cleanupBookkeeping() {
  if (!user?.owner) throw Error("Owner access is required.");
  const cutoff = Date.now() - 7 * 86400000;
  let count = 0;
  if (local) {
    const records = await localAll(),
      remove = [...records]
        .filter(
          ([path, value]) =>
            path.startsWith("requests/") && value.expiresAt <= Date.now(),
        )
        .map(([path]) => path);
    if (remove.length)
      await new Promise((resolve, reject) => {
        const tx = db.transaction("records", "readwrite");
        for (const path of remove) tx.objectStore("records").delete(path);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    return remove.length;
  }
  await connect();
  for (const [collection, field, time] of [
    ["requests", "expiresAt", Date.now()],
    ["clientMutations", "createdAt", cutoff],
    ["clientClock", "at", cutoff],
  ]) {
    const docs = await fb.getDocs(
      fb.query(
        fb.collection(fb.db, collection),
        fb.where(field, "<=", fb.Timestamp.fromMillis(time)),
        fb.limit(400),
      ),
    );
    if (docs.size) {
      const batch = fb.writeBatch(fb.db);
      for (const doc of docs.docs) batch.delete(doc.ref);
      await batch.commit();
      count += docs.size;
    }
  }
  return count;
}
