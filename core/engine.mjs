import { imageDimensions } from "./media.mjs";
import {
  schemas,
  validate,
  permitted,
  permissions,
  roleDefaults,
  stages,
  conditions,
  eventStates,
  finances,
} from "./schema.mjs";
const childTypes = ["tasks", "rundown", "setlists", "rig", "documents"];
const no = (message) => {
  throw Error(message);
};
const need = (u, p) =>
  permitted(u, p) ||
  no("Permission denied. Ask an owner to update your access.");
const id = (v) =>
  typeof v === "string" && /^[-\w]{1,100}$/.test(v)
    ? v
    : no("Invalid identifier.");
export async function execute(
  tx,
  uid,
  request,
  { now, randomId, privileged = false, staticClient = false } = {},
) {
  const { op, requestId } = request;
  id(requestId);
  const user = await tx.get(`users/${uid}`);
  if (!user?.active) no("Membership is inactive or has not been provisioned.");
  const replay = await tx.get(`requests/${uid}_${requestId}`);
  if (replay) return replay.result;
  const timestamp = now();
  const changes = [];
  const originalRecords = new Map();
  const out = { ok: true };
  async function put(path, data, old) {
    const before = old === undefined ? await tx.get(path) : old;
    if (!originalRecords.has(path)) originalRecords.set(path, before);
    const original = originalRecords.get(path);
    const after = {
      ...data,
      updatedAt: timestamp,
      updatedBy: uid,
      revision: (original?.revision || 0) + 1,
    };
    if (!original) after.createdAt = timestamp;
    tx.set(path, after);
    changes.push({
      target: path,
      before: before ? redact(before) : null,
      after: redact(after),
    });
    return after;
  }
  async function remove(path) {
    const before = await tx.get(path);
    tx.delete(path);
    changes.push({ target: path, before: redact(before), after: null });
  }
  async function eventAccess(eventId, manage = false) {
    const ev = await tx.get(`events/${id(eventId)}`);
    if (!ev) no("Event no longer exists.");
    if (ev.status === "Archived" && op !== "reopen" && op !== "duplicateEvent")
      no(
        "Archived events are locked. Reopen with an authorized manager first.",
      );
    const assigned = ev.memberUids?.includes(uid);
    if (!user.owner && !permitted(user, "operations.read") && !assigned)
      no("You are not assigned to this event.");
    if (
      manage &&
      !user.owner &&
      !(
        permitted(user, "events.write") &&
        (permitted(user, "operations.read") || ev.managerUid === uid)
      )
    )
      no("Event manager access is required.");
    return ev;
  }
  async function revision(old, base) {
    if (old && old.revision !== base)
      no(
        "This record changed. Refresh and review the latest version before saving.",
      );
  }
  async function equipmentChange(equipmentId, patch) {
    const path = `equipment/${id(equipmentId)}`;
    const item = await tx.get(path);
    if (!item) no("Equipment record no longer exists.");
    const saved = await put(path, { ...item, ...patch }, item);
    if (item.eventId) {
      const assignmentPath = `events/${item.eventId}/assignments/${equipmentId}`,
        assignment = await tx.get(assignmentPath);
      if (assignment)
        await put(
          assignmentPath,
          {
            ...assignment,
            name: saved.name,
            assetId: saved.assetId,
            stage: saved.stage,
            condition: saved.condition,
            location: saved.location || "",
          },
          assignment,
        );
    }
    return saved;
  }
  if (op === "lookupAsset") {
    const code = String(request.assetId || "").toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9-]{1,48}$/.test(code)) no("Invalid asset code.");
    const types = request.type
      ? [request.type]
      : ["equipment", "cases", "crew"];
    if (types.some((t) => !["equipment", "cases", "crew"].includes(t)))
      no("Invalid asset type.");
    let found = false;
    for (const type of types) {
      const index = await tx.get(`assetIds/${type}_${code}`);
      if (!index) continue;
      const row = await tx.get(`${type}/${index.recordId}`);
      if (!row) continue;
      if (type === "crew") {
        if (!permitted(user, "crew.read") && user.crewId !== index.recordId)
          continue;
      } else if (!permitted(user, "operations.read")) {
        if (!row.eventId) continue;
        await eventAccess(row.eventId);
      }
      out.id = index.recordId;
      out.type = type;
      found = true;
      break;
    }
    if (!found) no("Asset not found or not authorized.");
  } else if (op === "save") {
    const type = id(request.type),
      schema = schemas[type];
    if (!schema) no("Unknown record type.");
    let parent = "";
    let event;
    if (childTypes.includes(type)) {
      event = await eventAccess(request.eventId, true);
      parent = `events/${id(request.eventId)}/`;
    } else need(user, schema.write);
    const recordId = request.id ? id(request.id) : randomId(),
      path = `${parent}${type}/${recordId}`;
    const old = await tx.get(path);
    await revision(old, request.baseRevision);
    const data = validate(type, request.data || {});
    if (type === "events" && data.status === "Archived")
      no("Use archive to preserve a snapshot.");
    if (type === "maintenance" && !data.equipmentId)
      no("Choose the affected equipment.");
    if (
      type === "maintenance" &&
      !permitted(user, "equipment.write") &&
      !user.owner
    ) {
      if (old) no("Only equipment managers may edit submitted issues.");
      if (!data.eventId) no("Crew issue reports require an assigned event.");
      await eventAccess(data.eventId);
      const affected = await tx.get(`equipment/${data.equipmentId}`);
      if (affected?.eventId !== data.eventId)
        no("Equipment must belong to your event.");
    }
    for (const field of schema.fields.filter(
      (f) => f.type === "ref" || f.type === "refs",
    ))
      for (const value of field.type === "refs"
        ? data[field.key] || []
        : data[field.key]
          ? [data[field.key]]
          : []) {
        const referenced = await tx.get(`${field.collection}/${id(value)}`);
        if (!referenced) no(`${field.label} no longer exists.`);
        if (field.collection === "events") await eventAccess(value);
      }
    if (type === "rig") {
      if (!data.equipmentId) no("Choose a fixture.");
      const eq = await tx.get(`equipment/${data.equipmentId}`);
      if (eq.eventId !== request.eventId)
        no("Assign the fixture to this event first.");
      const lockPath = `events/${request.eventId}/rigLocks/${data.equipmentId}`,
        lock = await tx.get(lockPath);
      if (lock && lock.positionId !== recordId)
        no("Fixture already has a rig position.");
      tx.set(lockPath, { equipmentId: data.equipmentId, positionId: recordId });
      if (old?.equipmentId && old.equipmentId !== data.equipmentId)
        tx.delete(`events/${request.eventId}/rigLocks/${old.equipmentId}`);
      const positions = await tx.query(`events/${request.eventId}/rig`);
      if (
        positions.some(
          (r) => r.equipmentId === data.equipmentId && r.id !== recordId,
        )
      )
        no("Fixture already has a rig position.");
      if (
        old &&
        old.equipmentId !== data.equipmentId &&
        ["Installed", "Rigged", "In use"].includes(
          (await tx.get(`equipment/${old.equipmentId}`))?.stage,
        )
      )
        no("Strike the previous fixture before replacing it.");
    }
    if (data.assetId) {
      const key = `assetIds/${type}_${data.assetId}`,
        registered = await tx.get(key);
      if (registered && registered.recordId !== recordId)
        no("That asset ID is already in use.");
      tx.set(key, { recordId, type, assetId: data.assetId });
      if (old?.assetId && old.assetId !== data.assetId)
        tx.delete(`assetIds/${type}_${old.assetId}`);
    }
    if (type === "tasks") {
      const list = (data.dependencies || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (list.includes(recordId)) no("A task cannot depend on itself.");
      const tasks = await tx.query(`${parent}tasks`);
      const graph = new Map(
        tasks.map((t) => [
          t.id,
          (t.dependencies || "")
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
        ]),
      );
      graph.set(recordId, list);
      const visit = (key, trail = []) => {
        if (trail.includes(key)) no("Task dependencies contain a cycle.");
        if (!graph.has(key)) no("A dependency no longer exists.");
        for (const next of graph.get(key)) visit(next, [...trail, key]);
      };
      visit(recordId);
      data.dependencyIds = list;
    }
    if (
      type === "ledger" &&
      ["Revenue received", "Expense paid", "Crew payment"].includes(
        data.kind,
      ) &&
      data.status !== "Paid"
    )
      no("Cash receipts and paid expenses must have Paid status.");
    if (
      type === "purchaseGoals" &&
      data.status === "Purchased" &&
      old?.status !== "Purchased"
    )
      no("Use Record Purchase to create inventory and a paid ledger entry.");
    if (
      type === "equipment" &&
      old?.condition === "Unsafe" &&
      data.condition !== "Unsafe"
    ) {
      const reports = await tx.query("maintenance", [
        ["equipmentId", "==", recordId],
      ]);
      if (
        reports.some(
          (r) =>
            r.severity === "Critical" &&
            !["Resolved", "Retired"].includes(r.status),
        )
      )
        no(
          "Resolve critical maintenance reports before clearing the unsafe flag.",
        );
    }
    if (type === "ledger" && old && !data.notes)
      no("Provide a reason when correcting a financial entry.");
    if (
      type === "ledger" &&
      data.kind === "Crew payment" &&
      (!data.crewId || !data.eventId)
    )
      no("Crew payments need an event and crew member.");
    if (type === "events" && old) await eventAccess(recordId, true);
    const initial =
      type === "events"
        ? { memberUids: [uid], managerUid: uid, crewIds: [], status: "Draft" }
        : type === "tasks"
          ? { status: "Open", order: timestamp }
          : ["equipment", "cases"].includes(type)
            ? {
                stage: "Available",
                condition: "Good",
                qrId: randomId(),
                ...(type === "cases" ? { equipmentIds: [] } : {}),
              }
            : type === "crew"
              ? { qrId: randomId() }
              : type === "setlists"
                ? { songs: [] }
                : type === "purchaseGoals"
                  ? { allocated: 0 }
                  : {};
    const saved = await put(path, { ...initial, ...old, ...data }, old);
    out.id = recordId;
    if (type === "equipment" && old?.eventId) {
      const assignmentPath = `events/${old.eventId}/assignments/${recordId}`,
        assignment = await tx.get(assignmentPath);
      if (assignment)
        await put(
          assignmentPath,
          {
            ...assignment,
            name: saved.name,
            assetId: saved.assetId,
            condition: saved.condition,
          },
          assignment,
        );
    }
    if (
      type === "purchaseGoals" &&
      !["Purchased", "Canceled"].includes(saved.status) &&
      (saved.allocated || 0) > (saved.price || 0) * (saved.quantity || 1)
    )
      no("Reduce the existing allocation before lowering this goal total.");
    if (saved.qrId && !old) tx.set(`qr/${saved.qrId}`, { type, recordId });
    if (
      type === "events" &&
      old &&
      (old.status !== saved.status ||
        old.date !== saved.date ||
        old.crewCall !== saved.crewCall)
    )
      await notify(
        (saved.memberUids || []).filter((id) => id !== uid),
        `Event updated: ${saved.name}`,
        `#/events/${recordId}`,
      );
    if (
      type === "equipment" &&
      old?.eventId &&
      data.condition === "Missing" &&
      old.condition !== "Missing"
    ) {
      const affectedEvent = await tx.get(`events/${old.eventId}`);
      await notify(
        affectedEvent?.memberUids || [],
        `Missing equipment: ${saved.assetId}`,
        `#/equipment/${recordId}`,
      );
    }
    if (type === "events" && !old) {
      const qrId = randomId();
      tx.set(`qr/${qrId}`, { type, recordId });
      tx.set(path, { ...saved, qrId });
    }
    if (type === "maintenance") {
      const eq = await tx.get(`equipment/${data.equipmentId}`);
      const reports = await tx.query("maintenance", [
        ["equipmentId", "==", data.equipmentId],
      ]);
      const unresolved = reports.filter(
        (r) => r.id !== recordId && !["Resolved", "Retired"].includes(r.status),
      );
      const critical =
        data.severity === "Critical" &&
        !["Resolved", "Retired"].includes(data.status);
      if (critical || unresolved.some((r) => r.severity === "Critical"))
        await equipmentChange(data.equipmentId, { condition: "Unsafe" });
      if (["Resolved", "Retired"].includes(data.status))
        tx.set(path, { ...saved, resolvedAt: timestamp });
      if (eq.eventId) {
        const ev = await tx.get(`events/${eq.eventId}`);
        await notify(
          ev?.memberUids || [],
          `Equipment issue: ${data.name}`,
          `#/maintenance/${recordId}`,
        );
      }
    }
    if (type === "tasks" && data.assigneeId) {
      const member = (
        await tx.query("users", [["crewId", "==", data.assigneeId]])
      ).find((u) => u.active);
      if (member)
        await notify(
          [member.id],
          `Task assigned: ${data.name}`,
          `#/events/${request.eventId}?tab=tasks`,
        );
    }
    if (type === "ledger") {
      await updateLedgerTotals(old, saved);
      await assertFunds();
      if (data.crewId && (!old || old.status !== saved.status)) {
        const members = await tx.query("users", [
          ["crewId", "==", data.crewId],
        ]);
        await notify(
          members.filter((u) => u.active).map((u) => u.id),
          `Crew payment record: ${saved.status || "Updated"}`,
          "#/notifications",
        );
      }
    }
    if (type === "purchaseGoals") {
      await adjustAllocated(allocation(saved) - allocation(old));
      await assertFunds();
    }
  } else if (op === "assignCase") {
    need(user, "equipment.write");
    const equipment = await tx.get(`equipment/${id(request.equipmentId)}`);
    if (!equipment) no("Equipment no longer exists.");
    await revision(equipment, request.baseRevision);
    if (equipment.eventId)
      no("Return equipment before changing its permanent case.");
    if (request.caseId) {
      const roadCase = await tx.get(`cases/${id(request.caseId)}`);
      if (!roadCase) no("Case no longer exists.");
      if (roadCase.eventId)
        no("Return the case before changing its standard contents.");
    }
    await equipmentChange(request.equipmentId, {
      caseId: request.caseId || null,
    });
    if (equipment.caseId !== request.caseId)
      for (const caseId of new Set(
        [equipment.caseId, request.caseId].filter(Boolean),
      )) {
        const path = `cases/${caseId}`,
          c = await tx.get(path);
        if (c)
          await put(
            path,
            {
              ...c,
              contentsVersion: (c.contentsVersion || 0) + 1,
              equipmentIds:
                caseId === request.caseId
                  ? [
                      ...new Set([
                        ...(c.equipmentIds || []),
                        request.equipmentId,
                      ]),
                    ]
                  : (c.equipmentIds || []).filter(
                      (key) => key !== request.equipmentId,
                    ),
            },
            c,
          );
      }
  } else if (op === "assignEvent") {
    const ev = await eventAccess(request.eventId, true);
    if (
      !Array.isArray(request.equipmentIds || []) ||
      !Array.isArray(request.caseIds || []) ||
      (request.caseIds || []).length > 30
    )
      no("Choose at most 30 cases per reservation.");
    const equipmentIds = new Set(request.equipmentIds || []);
    if (equipmentIds.size > 100) no("Assign at most 100 loose assets at once.");
    for (const caseId of request.caseIds || []) {
      const c = await tx.get(`cases/${id(caseId)}`);
      if (!c) no("Case no longer exists.");
      if (
        ["Unsafe", "Damaged", "Missing", "Retired"].includes(c.condition) &&
        !(permitted(user, "dependencies.override") && request.reason?.trim())
      )
        no("Unavailable case requires an authorized override reason.");
      if (c.eventId && c.eventId !== request.eventId)
        no("Case is committed to another event.");
      if (
        c.eventId === request.eventId &&
        (await tx.get(`events/${request.eventId}/caseAssignments/${caseId}`))
      )
        continue;
      const contents = await tx.query("equipment", [["caseId", "==", caseId]]);
      for (const e of contents) equipmentIds.add(e.id);
      await put(
        `cases/${caseId}`,
        { ...c, eventId: request.eventId, stage: "Reserved" },
        c,
      );
      await put(`events/${request.eventId}/caseAssignments/${caseId}`, {
        caseId,
        name: c.name,
        assetId: c.assetId,
        verifiedIds: [],
        expectedIds: contents.map((e) => e.id),
        stage: "Reserved",
        location: c.location || "",
        order: timestamp,
      });
    }
    if (equipmentIds.size > 180)
      no("Assign fewer cases in one operation (180 assets maximum).");
    for (const equipmentId of equipmentIds) {
      const e = await tx.get(`equipment/${id(equipmentId)}`);
      if (!e) no("Equipment no longer exists.");
      if (e.eventId && e.eventId !== request.eventId)
        no(`${e.assetId} is committed to another event.`);
      if (
        e.eventId === request.eventId &&
        (await tx.get(`events/${request.eventId}/assignments/${equipmentId}`))
      ) {
        if ((request.caseIds || []).includes(e.caseId)) {
          const path = `events/${request.eventId}/assignments/${equipmentId}`,
            prior = await tx.get(path);
          if (prior.caseId !== e.caseId) {
            if (e.stage !== "Reserved")
              no("Return deployed equipment before changing event packing.");
            await put(path, { ...prior, caseId: e.caseId }, prior);
          }
        }
        continue;
      }
      if (
        ["Unsafe", "Damaged", "Under repair", "Missing", "Retired"].includes(
          e.condition,
        ) &&
        !(permitted(user, "dependencies.override") && request.reason?.trim())
      )
        no(`${e.assetId} requires an authorized override reason.`);
      await equipmentChange(equipmentId, {
        eventId: request.eventId,
        stage: "Reserved",
      });
      const path = `events/${request.eventId}/assignments/${equipmentId}`;
      const prior = await tx.get(path);
      await put(
        path,
        {
          ...prior,
          equipmentId,
          assetId: e.assetId,
          name: e.name,
          caseId: (request.caseIds || []).includes(e.caseId) ? e.caseId : null,
          condition: e.condition,
          stage: "Reserved",
        },
        prior,
      );
    }
  } else if (op === "eventCaseItem") {
    await eventAccess(request.eventId, true);
    const c = await tx.get(
      `events/${id(request.eventId)}/caseAssignments/${id(request.caseId)}`,
    );
    if (!c) no("Reserve the case first.");
    if (!["Reserved", "Checking"].includes(c.stage))
      no("Change event packing before the case is packed or loaded.");
    const e = await tx.get(`equipment/${id(request.equipmentId)}`);
    if (!e) no("Equipment no longer exists.");
    if (e.eventId && e.eventId !== request.eventId)
      no("Equipment is committed elsewhere.");
    if (e.caseId && e.caseId !== request.caseId)
      no(
        "Equipment belongs to another permanent case. Reserve that case separately.",
      );
    if (!["Good", "Needs inspection"].includes(e.condition))
      no("Resolve equipment condition before packing.");
    await equipmentChange(request.equipmentId, {
      eventId: request.eventId,
      stage: "Reserved",
    });
    await put(`events/${request.eventId}/assignments/${request.equipmentId}`, {
      equipmentId: request.equipmentId,
      name: e.name,
      assetId: e.assetId,
      caseId: request.caseId,
      condition: e.condition,
      stage: "Reserved",
      eventOnly: true,
    });
    await put(
      `events/${request.eventId}/caseAssignments/${request.caseId}`,
      {
        ...c,
        expectedIds: [
          ...new Set([...(c.expectedIds || []), request.equipmentId]),
        ],
      },
      c,
    );
  } else if (op === "releaseEquipment") {
    await eventAccess(request.eventId, true);
    const e = await tx.get(`equipment/${id(request.equipmentId)}`);
    if (e?.eventId !== request.eventId) no("Equipment is not assigned here.");
    if (!["Reserved", "Returned", "Available"].includes(e.stage))
      no("Return deployed equipment before removing its reservation.");
    await equipmentChange(request.equipmentId, {
      eventId: null,
      stage: "Available",
    });
    await remove(
      `events/${request.eventId}/assignments/${request.equipmentId}`,
    );
  } else if (op === "equipmentStage") {
    const eq = await tx.get(`equipment/${id(request.equipmentId)}`);
    if (!eq) no("Equipment no longer exists.");
    if (eq.eventId) {
      await eventAccess(eq.eventId);
      if (!permitted(user, "equipment.write")) need(user, "equipment.status");
    } else need(user, "equipment.write");
    await revision(eq, request.baseRevision);
    if (
      request.stage === "Returned" &&
      ["Installed", "Rigged", "In use"].includes(eq.stage)
    )
      no("Mark equipment struck before confirming return.");
    if (!stages.includes(request.stage)) no("Invalid deployment stage.");
    if (
      ["Installed", "Rigged", "In use"].includes(request.stage) &&
      ["Unsafe", "Damaged", "Under repair", "Missing", "Retired"].includes(
        eq.condition,
      ) &&
      !(permitted(user, "dependencies.override") && request.reason?.trim())
    )
      no("Unsafe equipment requires an authorized override reason.");
    if (!eq.eventId && !["Available", "Returned"].includes(request.stage))
      no("Assign equipment to an event first.");
    await equipmentChange(request.equipmentId, {
      stage: request.stage,
      location: request.location || eq.location || "",
      ...(request.stage === "Returned" ? { eventId: null } : {}),
    });
  } else if (op === "caseVerify") {
    need(user, "cases.verify");
    await eventAccess(request.eventId);
    const path = `events/${id(request.eventId)}/caseAssignments/${id(request.caseId)}`;
    const assignment = await tx.get(path);
    if (!assignment) no("Case is not assigned to this event.");
    await revision(assignment, request.baseRevision);
    const contents = (
      await tx.query(`events/${request.eventId}/assignments`, [
        ["caseId", "==", request.caseId],
      ])
    ).filter((e) => e.stage !== "Released");
    const checked = [...new Set(request.verifiedIds || [])];
    if (checked.some((e) => !contents.some((c) => c.id === e)))
      no("Unexpected case item.");
    if (
      !["Checking", "Packed", "Loaded", "Unloaded", "Returned"].includes(
        request.stage,
      )
    )
      no("Invalid case stage.");
    if (
      ["Packed", "Loaded", "Returned"].includes(request.stage) &&
      contents.some((e) => !checked.includes(e.id))
    )
      no(
        "Verify every expected item. Missing equipment must be resolved first.",
      );
    if (request.stage === "Returned") {
      for (const e of contents) {
        const live = await tx.get(`equipment/${e.id}`);
        if (["Installed", "Rigged", "In use"].includes(live?.stage))
          no(`Strike ${e.assetId} before returning its case.`);
      }
    }
    await put(
      path,
      {
        ...assignment,
        verifiedIds: checked,
        stage: request.stage,
        location: request.location || assignment.location || "",
        verifiedBy: uid,
        verifiedAt: timestamp,
      },
      assignment,
    );
    const c = await tx.get(`cases/${request.caseId}`);
    await put(
      `cases/${request.caseId}`,
      {
        ...c,
        stage: request.stage,
        location: request.location || c.location || "",
        ...(request.stage === "Returned" ? { eventId: null } : {}),
      },
      c,
    );
    if (request.stage !== "Checking")
      for (const e of contents) {
        await equipmentChange(e.id, {
          stage: request.stage,
          location: request.location || c.location || "",
          ...(request.stage === "Returned" ? { eventId: null } : {}),
        });
      }
  } else if (op === "taskComplete") {
    const ev = await eventAccess(request.eventId);
    const path = `events/${id(request.eventId)}/tasks/${id(request.id)}`,
      task = await tx.get(path);
    if (!task) no("Task no longer exists.");
    const manage =
      user.owner ||
      (permitted(user, "events.write") &&
        (permitted(user, "operations.read") || ev.managerUid === uid));
    if (!manage && task.assigneeId !== user.crewId)
      no(
        "Only the assigned crew member or event manager can change this task.",
      );
    if (!manage) need(user, "tasks.complete");
    const status = request.complete ? "Complete" : "Open";
    if (task.status === status) return { ok: true, unchanged: true };
    await revision(task, request.baseRevision);
    if (request.complete) {
      for (const dep of (task.dependencies || "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)) {
        const dependency = await tx.get(
          `events/${request.eventId}/tasks/${id(dep)}`,
        );
        if (
          dependency?.status !== "Complete" &&
          !(
            manage &&
            permitted(user, "dependencies.override") &&
            request.reason?.trim()
          )
        )
          no(
            "Complete dependencies first, or record an authorized override reason.",
          );
      }
    }
    await put(
      path,
      {
        ...task,
        status,
        completedAt: request.complete ? timestamp : null,
        completedBy: request.complete ? uid : null,
      },
      task,
    );
  } else if (op === "eventManager") {
    const ev = await eventAccess(request.eventId, true);
    const crew = await tx.get(`crew/${id(request.crewId)}`);
    if (!crew) no("Crew profile no longer exists.");
    const target = (
      await tx.query("users", [["crewId", "==", request.crewId]])
    ).find((u) => u.active && permitted(u, "events.write"));
    if (!target)
      no(
        "Link this crew profile to an active account with event-management permission first.",
      );
    const roster = await tx.query(`events/${request.eventId}/roster`);
    const members = new Set(ev.memberUids || []);
    if (!roster.some((r) => r.uid === ev.managerUid))
      members.delete(ev.managerUid);
    members.add(target.id);
    await put(
      `events/${request.eventId}`,
      {
        ...ev,
        managerUid: target.id,
        managerName: crew.name,
        memberUids: [...members],
      },
      ev,
    );
  } else if (op === "crewAssign") {
    const ev = await eventAccess(request.eventId, true);
    const crew = await tx.get(`crew/${id(request.crewId)}`);
    if (!crew) no("Crew member no longer exists.");
    const member = (
      await tx.query("users", [["crewId", "==", request.crewId]])
    ).find((u) => u.active);
    const roster = await tx.query(`events/${request.eventId}/roster`);
    if (roster.length >= 100) no("100 crew maximum per event.");
    const path = `events/${request.eventId}/roster/${request.crewId}`;
    if (request.remove) await remove(path);
    else
      await put(path, {
        crewId: request.crewId,
        name: crew.name,
        roles: request.roles || crew.roles || "",
        uid: member?.id || null,
      });
    const all = request.remove
      ? roster.filter((r) => r.crewId !== request.crewId)
      : [
          ...roster.filter((r) => r.crewId !== request.crewId),
          { uid: member?.id },
        ];
    await put(
      `events/${request.eventId}`,
      {
        ...ev,
        memberUids: [
          ...new Set([ev.managerUid, ...all.map((r) => r.uid).filter(Boolean)]),
        ],
        crewIds: [
          ...new Set(
            (request.remove
              ? roster.filter((r) => r.crewId !== request.crewId)
              : [...roster, { crewId: request.crewId }]
            ).map((r) => r.crewId),
          ),
        ],
      },
      ev,
    );
    if (member && !request.remove)
      await notify(
        [member.id],
        `Assigned to ${ev.name}`,
        `#/events/${request.eventId}`,
      );
  } else if (op === "rigState") {
    need(user, "rig.update");
    await eventAccess(request.eventId);
    const p = `events/${id(request.eventId)}/rig/${id(request.id)}`,
      position = await tx.get(p);
    if (!position) no("Rig position no longer exists.");
    await revision(position, request.baseRevision);
    if (!["Installed", "Struck"].includes(request.state))
      no("Invalid rig state.");
    const eq = await tx.get(`equipment/${position.equipmentId}`);
    if (eq?.eventId !== request.eventId)
      no("The fixture is no longer assigned to this event.");
    if (
      request.state === "Installed" &&
      ["Unsafe", "Damaged", "Under repair", "Missing", "Retired"].includes(
        eq.condition,
      )
    )
      no("Unsafe equipment cannot be installed from the rig view.");
    await equipmentChange(position.equipmentId, {
      stage: request.state,
      location: position.section || eq.location || "",
    });
    await put(p, { ...position, state: request.state }, position);
  } else if (op === "segmentComplete") {
    await eventAccess(request.eventId, true);
    const p = `events/${id(request.eventId)}/rundown/${id(request.id)}`,
      row = await tx.get(p);
    if (!row) no("Segment no longer exists.");
    await revision(row, request.baseRevision);
    await put(
      p,
      {
        ...row,
        status: request.complete ? "Complete" : "Open",
        actualTime: request.complete ? timestamp : null,
      },
      row,
    );
  } else if (op === "reorder") {
    await eventAccess(request.eventId, true);
    if (
      !["tasks", "rundown", "setlists", "caseAssignments"].includes(
        request.type,
      ) ||
      !Array.isArray(request.ids) ||
      request.ids.length > 150
    )
      no("Invalid ordering.");
    for (const [index, key] of request.ids.entries()) {
      const path = `events/${id(request.eventId)}/${request.type}/${id(key)}`;
      const row = await tx.get(path);
      if (!row) no("A record no longer exists.");
      await revision(row, request.revisions?.[key]);
      await put(path, { ...row, order: index }, row);
    }
  } else if (op === "setlistPerform") {
    need(user, "setlists.perform");
    await eventAccess(request.eventId);
    const path = `events/${id(request.eventId)}/setlists/${id(request.id)}`,
      list = await tx.get(path);
    if (!list) no("Setlist no longer exists.");
    await revision(list, request.baseRevision);
    const song = list.songs?.find((s) => s.id === request.songId);
    if (!song) no("Song no longer exists.");
    const feedback = ["Excellent", "Good", "Average", "Poor"].includes(
      request.feedback,
    )
      ? request.feedback
      : "";
    await put(
      path,
      {
        ...list,
        songs: list.songs.map((s) =>
          s.id === request.songId
            ? { ...s, played: !!request.played, feedback }
            : s,
        ),
      },
      list,
    );
  } else if (op === "rundownTimes") {
    await eventAccess(request.eventId, true);
    if (!/^\d{2}:\d{2}$/.test(request.start || "")) no("Invalid start time.");
    const [hour, minute] = request.start.split(":").map(Number);
    if (hour > 23 || minute > 59) no("Invalid start time.");
    let minutes = hour * 60 + minute;
    if (!Array.isArray(request.ids) || request.ids.length > 150)
      no("Maximum 150 segments.");
    for (const key of request.ids) {
      const path = `events/${id(request.eventId)}/rundown/${id(key)}`,
        row = await tx.get(path);
      if (!row) no("Segment no longer exists.");
      await revision(row, request.revisions?.[key]);
      const startTime = `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
      await put(
        path,
        { ...row, startTime, dayOffset: Math.floor(minutes / 1440) },
        row,
      );
      minutes += row.duration || 0;
    }
  } else if (op === "eventTemplate") {
    need(user, "settings.write");
    await eventAccess(request.eventId, true);
    const templateId = randomId(),
      plan = {};
    for (const kind of ["tasks", "setlists", "rundown"])
      plan[kind] = await tx.query(`events/${request.eventId}/${kind}`);
    if (JSON.stringify(plan).length > 500000) no("Template is too large.");
    await put(
      `templates/${templateId}`,
      {
        name: String(request.name || "Event template").slice(0, 150),
        nameKey: String(request.name || "Event template").toLowerCase(),
        type: "Event",
        plan,
      },
      null,
    );
    out.id = templateId;
  } else if (op === "applyTemplate") {
    await eventAccess(request.eventId, true);
    const template = await tx.get(`templates/${id(request.templateId)}`);
    if (template?.type !== "Event") no("Choose an event template.");
    const idMap = new Map(
      (template.plan?.tasks || []).map((t) => [t.id, randomId()]),
    );
    for (const kind of ["tasks", "setlists", "rundown"])
      for (const row of template.plan?.[kind] || []) {
        const clean = {
          ...validate(kind, row),
          ...(kind === "setlists"
            ? {
                songs: (row.songs || []).map((s) => ({
                  ...s,
                  played: false,
                  feedback: "",
                })),
              }
            : {}),
        };
        if (kind === "tasks") {
          clean.dependencies = (row.dependencies || "")
            .split(",")
            .map((k) => idMap.get(k.trim()))
            .filter(Boolean)
            .join(",");
          delete clean.assigneeId;
        }
        if (kind === "rundown") delete clean.crewId;
        await put(
          `events/${request.eventId}/${kind}/${kind === "tasks" ? idMap.get(row.id) : randomId()}`,
          { ...clean, status: "Open", order: row.order || 0 },
          null,
        );
      }
  } else if (op === "setlistSongs") {
    await eventAccess(request.eventId, true);
    const path = `events/${id(request.eventId)}/setlists/${id(request.id)}`,
      list = await tx.get(path);
    if (!list) no("Setlist no longer exists.");
    await revision(list, request.baseRevision);
    if (!Array.isArray(request.songs) || request.songs.length > 300)
      no("Maximum 300 songs per setlist.");
    const songs = request.songs.map((s) => ({
      ...validate("songs", s),
      id: id(s.id || randomId()),
      transition: String(s.transition || "").slice(0, 2000),
      plannedTime: String(s.plannedTime || "").slice(0, 30),
      played: !!s.played,
      feedback: ["Excellent", "Good", "Average", "Poor"].includes(s.feedback)
        ? s.feedback
        : "",
    }));
    await put(path, { ...list, songs }, list);
  } else if (op === "archive") {
    const ev = await eventAccess(request.eventId, true);
    if (ev.status !== "Completed") no("Complete the event before archiving.");
    const assignments = await tx.query(`events/${request.eventId}/assignments`);
    if (assignments.some((e) => e.stage !== "Returned"))
      no("Confirm all equipment returned before archiving.");
    const caseRecords = await tx.query(
      `events/${request.eventId}/caseAssignments`,
    );
    if (caseRecords.some((c) => c.stage !== "Returned"))
      no("Confirm all road cases returned before archiving.");
    const snapshot = { event: ev, snapshotAt: timestamp };
    for (const kind of [
      "assignments",
      "caseAssignments",
      "roster",
      "tasks",
      "rig",
      "setlists",
      "rundown",
      "documents",
    ])
      snapshot[kind] = await tx.query(`events/${request.eventId}/${kind}`);
    for (const image of await tx.query("images", [
      ["eventId", "==", request.eventId],
    ]))
      if (image.targetType !== "crew")
        await put(
          `archives/${request.eventId}/images/${image.id}`,
          { ...image, expiresAt: null },
          null,
        );
    snapshot.maintenance = await tx.query("maintenance", [
      ["eventId", "==", request.eventId],
    ]);
    if (!staticClient || user.owner || permitted(user, "finance.read")) {
      const ledger = await tx.query("ledger", [
        ["eventId", "==", request.eventId],
      ]);
      await put(`archiveFinance/${request.eventId}`, {
        eventId: request.eventId,
        ledger,
        summary: finances(ledger),
      });
    }
    if (JSON.stringify(snapshot).length > 650000)
      no(
        "Event snapshot exceeds the archive limit. Export data and reduce oversized notes first.",
      );
    const previous = await tx.get(`archives/${request.eventId}`);
    if (previous)
      await put(
        `archives/${request.eventId}/versions/${randomId()}`,
        previous,
        null,
      );
    await put(`archives/${request.eventId}`, snapshot);
    await put(
      `events/${request.eventId}`,
      { ...ev, status: "Archived", archivedAt: timestamp },
      ev,
    );
  } else if (op === "reopen") {
    need(user, "events.write");
    need(user, "operations.read");
    const ev = await tx.get(`events/${id(request.eventId)}`);
    if (!ev || ev.status !== "Archived" || !request.reason?.trim())
      no("An archived event and reopening reason are required.");
    await put(`events/${request.eventId}`, { ...ev, status: "Completed" }, ev);
  } else if (op === "duplicateEvent") {
    const source = await eventAccess(request.eventId, true);
    const newId = randomId();
    const ev = {
      ...validate("events", source),
      crewIds: [],
      name: request.name || `${source.name} — copy`,
      status: "Draft",
      memberUids: [uid],
      managerUid: uid,
      qrId: randomId(),
    };
    await put(`events/${newId}`, ev, null);
    tx.set(`qr/${ev.qrId}`, { type: "events", recordId: newId });
    for (const kind of ["tasks", "setlists", "rundown"])
      for (const row of await tx.query(`events/${request.eventId}/${kind}`)) {
        const clean = { ...row };
        delete clean.id;
        delete clean.completedAt;
        delete clean.completedBy;
        delete clean.actualTime;
        await put(
          `events/${newId}/${kind}/${row.id}`,
          {
            ...clean,
            status: "Open",
            ...(kind === "setlists"
              ? {
                  songs: (row.songs || []).map((s) => ({
                    ...s,
                    played: false,
                    feedback: "",
                  })),
                }
              : {}),
          },
          null,
        );
      }
    out.id = newId;
  } else if (op === "qrRotate") {
    need(user, "equipment.write");
    if (!["equipment", "cases", "crew", "events"].includes(request.type))
      no("Invalid QR target.");
    if (request.type === "crew") need(user, "crew.write");
    const p = `${request.type}/${id(request.id)}`,
      row = await tx.get(p);
    if (!row) no("Record no longer exists.");
    if (row.qrId) tx.delete(`qr/${row.qrId}`);
    const token = randomId();
    tx.set(`qr/${token}`, { type: request.type, recordId: request.id });
    await put(p, { ...row, qrId: token }, row);
    out.qrId = token;
  } else if (op === "allocate") {
    need(user, "finance.write");
    if (!Number.isSafeInteger(request.amount) || request.amount < 0)
      no("Invalid allocation.");
    const path = `purchaseGoals/${id(request.id)}`,
      goal = await tx.get(path);
    if (!goal) no("Purchase goal no longer exists.");
    if (["Purchased", "Canceled"].includes(goal.status))
      no("Only open purchase goals can receive allocations.");
    await revision(goal, request.baseRevision);
    if (request.amount > (goal.price || 0) * (goal.quantity || 1))
      no("Allocation exceeds the purchase goal.");
    await put(path, { ...goal, allocated: request.amount }, goal);
    await adjustAllocated(request.amount - allocation(goal));
    await assertFunds();
  } else if (op === "purchase") {
    need(user, "finance.write");
    need(user, "equipment.write");
    const p = `purchaseGoals/${id(request.id)}`,
      goal = await tx.get(p);
    if (!goal || ["Purchased", "Canceled"].includes(goal.status))
      no("Purchase is already complete, canceled, or missing.");
    const qty = goal.quantity || 1,
      cost = (goal.price || 0) * qty;
    await put(
      p,
      { ...goal, status: "Purchased", allocated: 0, purchasedAt: timestamp },
      goal,
    );
    await adjustAllocated(-allocation(goal));
    const purchaseLedger = {
      name: `Purchase: ${goal.name}`,
      kind: "Expense paid",
      amount: cost,
      date: new Date(timestamp).toISOString().slice(0, 10),
      status: "Paid",
      goalId: request.id,
    };
    await put(`ledger/${randomId()}`, purchaseLedger, null);
    await updateLedgerTotals(null, purchaseLedger);
    await assertFunds();
    for (let n = 1; n <= qty; n++) {
      const assetId = `${String(request.assetPrefix || "").toUpperCase()}-${String(n).padStart(2, "0")}`;
      if (!/^[A-Z0-9][A-Z0-9-]{1,48}$/.test(assetId))
        no("Enter a valid uppercase asset prefix.");
      const unique = await tx.get(`assetIds/equipment_${assetId}`);
      if (unique) no("An asset ID in this purchase already exists.");
      const recordId = randomId(),
        qrId = randomId();
      await put(
        `equipment/${recordId}`,
        {
          assetId,
          name: goal.name,
          nameKey: goal.name.toLowerCase(),
          category: goal.category || "Miscellaneous",
          manufacturer: goal.manufacturer || "",
          model: goal.model || "",
          condition: "Good",
          stage: "Available",
          qrId,
        },
        null,
      );
      tx.set(`assetIds/equipment_${assetId}`, {
        recordId,
        type: "equipment",
        assetId,
      });
      tx.set(`qr/${qrId}`, { type: "equipment", recordId });
      await put(
        `assetFinance/${recordId}`,
        {
          equipmentId: recordId,
          name: goal.name,
          purchasePrice: goal.price || 0,
          replacementCost: goal.price || 0,
        },
        null,
      );
    }
  } else if (op === "member") {
    need(user, "members.write");
    const target = id(request.uid);
    const old = await tx.get(`users/${target}`);
    if (old?.owner)
      no("Owner accounts are protected. Other memberships are managed here.");
    const roles = request.roles || ["Viewer"];
    if (!Array.isArray(roles) || roles.length > 10) no("Invalid roles.");
    const effective = {};
    for (const role of roles) {
      if (role === "Owner")
        no(
          "Owner access is reserved for the configured verified owner identity; select an operational role here.",
        );
      const spec = await tx.get(`roles/${id(role)}`);
      if (!spec) no("Unknown role.");
      for (const permission of permissions)
        if (spec.permissions?.[permission]) effective[permission] = true;
    }
    if (request.crewId) {
      const crew = await tx.get(`crew/${id(request.crewId)}`);
      if (!crew) no("Crew profile no longer exists.");
      const others = await tx.query("users", [
        ["crewId", "==", request.crewId],
      ]);
      if (others.some((u) => u.id !== target && u.active))
        no("Crew profile already has an active account.");
    }
    await put(
      `users/${target}`,
      {
        ...old,
        name: String(request.name || "").slice(0, 200),
        active: !!request.active,
        owner: false,
        roles,
        permissions: effective,
        crewId: request.crewId || null,
      },
      old,
    );
    const assignedEvents = await tx.query("events", [
      ["memberUids", "array-contains", target],
    ]);
    const linkedEvents = request.crewId
      ? await tx.query("events", [
          ["crewIds", "array-contains", request.crewId],
        ])
      : [];
    const affected = new Map(
      [...assignedEvents, ...linkedEvents].map((e) => [e.id, e]),
    );
    if (affected.size > 100)
      no(
        "More than 100 event memberships require a paginated administrator migration.",
      );
    for (const ev of affected.values()) {
      if (ev.status === "Archived") continue;
      const roster = await tx.query(`events/${ev.id}/roster`);
      let included = false;
      for (const r of roster) {
        const correct = !!request.active && r.crewId === request.crewId;
        if (r.uid === target || correct) {
          if (correct) included = true;
          await put(
            `events/${ev.id}/roster/${r.id}`,
            { ...r, uid: correct ? target : null },
            r,
          );
        }
      }
      const members = new Set(ev.memberUids || []);
      if (included || ev.managerUid === target) members.add(target);
      else members.delete(target);
      await put(`events/${ev.id}`, { ...ev, memberUids: [...members] }, ev);
    }
  } else if (op === "role") {
    if (!user.owner) no("Only an owner may configure role permissions.");
    const key = id(request.id);
    if (key === "Owner") no("Owner permissions are fixed.");
    const grants = Object.fromEntries(
      permissions
        .filter((p) => request.permissions?.[p] === true)
        .map((p) => [p, true]),
    );
    const users = await tx.query("users");
    if (users.length > 350)
      no("Use the administration migration tool for more than 350 accounts.");
    const allRoles = await tx.query("roles");
    await put(`roles/${key}`, {
      name: String(request.name || key).slice(0, 120),
      permissions: grants,
    });
    for (const member of users.filter(
      (u) => u.roles?.includes(key) && !u.owner,
    )) {
      const effective = {};
      for (const role of member.roles) {
        const spec =
          role === key
            ? { permissions: grants }
            : allRoles.find((r) => r.id === role);
        for (const permission of permissions)
          if (spec?.permissions?.[permission]) effective[permission] = true;
      }
      await put(
        `users/${member.id}`,
        { ...member, permissions: effective },
        member,
      );
    }
  } else if (op === "settings") {
    need(user, "settings.write");
    const allowed = [
      "company",
      "categories",
      "crewRoles",
      "labelTemplates",
      "badgeTemplates",
      "eventTemplates",
      "appearance",
      "imageSettings",
    ];
    if (!allowed.includes(request.id)) no("Unknown setting.");
    if (JSON.stringify(request.data).length > 40000)
      no("Setting is too large.");
    await put(`settings/${request.id}`, request.data);
  } else if (op === "profile") {
    await put(
      `users/${uid}`,
      {
        ...user,
        name: String(request.name || user.name || "").slice(0, 200),
        notificationPreferences: request.preferences
          ? { operations: request.preferences.operations !== false }
          : user.notificationPreferences || {},
      },
      user,
    );
  } else if (op === "notificationRead") {
    const p = `notifications/${id(request.id)}`,
      notification = await tx.get(p);
    if (notification?.uid !== uid) no("Permission denied.");
    await put(p, { ...notification, read: !!request.read }, notification);
  } else if (op === "notificationGenerate") {
    if (!user.owner) no("Owner access is required to refresh team alerts.");
    const recipient = await tx.get(`users/${id(request.uid)}`);
    if (
      !recipient?.active ||
      recipient.notificationPreferences?.operations === false
    )
      return { ok: true, unchanged: true };
    const path = `notifications/${id(request.key)}`;
    if (await tx.get(path)) return { ok: true, unchanged: true };
    if (!String(request.link || "").startsWith("#/"))
      no("Invalid notification link.");
    await put(
      path,
      {
        uid: request.uid,
        title: String(request.title || "").slice(0, 300),
        link: request.link,
        read: false,
      },
      null,
    );
  } else if (op === "imageExpire") {
    need(user, "equipment.write");
    const path = `images/${id(request.id)}`,
      img = await tx.get(path);
    if (!img) return { ok: true, unchanged: true };
    if (img.purpose !== "quick" || !img.expiresAt || img.expiresAt > timestamp)
      no("Photo is not expired.");
    const budget = await tx.get("imageBudget/global"),
      key = img.targetType + "_" + img.targetId;
    tx.set("imageBudget/global", {
      ...budget,
      bytes: Math.max(0, budget.bytes - img.bytes),
      counts: {
        ...budget.counts,
        [key]: Math.max(0, (budget.counts[key] || 0) - 1),
      },
    });
    await remove(path);
  } else if (op === "imageUpload") {
    const purpose = request.purpose || "permanent";
    if (purpose === "permanent") need(user, "equipment.write");
    else need(user, "maintenance.write");
    const type = request.targetType;
    if (!["equipment", "cases", "crew", "maintenance", "events"].includes(type))
      no("Invalid image target.");
    const row = await tx.get(`${type}/${id(request.targetId)}`);
    if (!row) no("Image target no longer exists.");
    if (type === "crew") need(user, "crew.write");
    if (!permitted(user, "operations.read") && !user.owner) {
      if (type === "events") await eventAccess(request.targetId);
      else if (row.eventId) await eventAccess(row.eventId);
      else no("Image target is not assigned to your event.");
    }
    const data = request.dataUrl;
    if (
      typeof data !== "string" ||
      !/^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(data) ||
      data.length > 260000
    )
      no("Image exceeds the encoded 260 KB limit or has an invalid format.");
    const dimensions = imageDimensions(data);
    if (
      dimensions.width !== request.width ||
      dimensions.height !== request.height
    )
      no("Image dimensions do not match the raster content.");
    if (
      !Number.isSafeInteger(request.width) ||
      !Number.isSafeInteger(request.height) ||
      request.width > 1280 ||
      request.height > 1280 ||
      request.width < 1 ||
      request.height < 1
    )
      no("Image dimensions are invalid.");
    const list = await tx.query("images", [
      ["targetId", "==", request.targetId],
    ]);
    if (list.length >= 8) no("Maximum 8 pending images per record.");
    const budget = (await tx.get("imageBudget/global")) || {
      bytes: 0,
      counts: {},
      rates: {},
    };
    const targetKey = `${type}_${request.targetId}`;
    if ((budget.counts?.[targetKey] || 0) >= 8)
      no("Maximum 8 pending images per record.");
    if (budget.bytes + data.length > 20000000)
      no("Temporary image storage is full.");
    const rate = budget.rates?.[uid] || { at: 0, count: 0 };
    if (timestamp - rate.at < 60000 && rate.count >= 10)
      no("Upload limit: 10 images per minute.");
    const imageId = randomId(),
      extension = data.startsWith("data:image/webp")
        ? "webp"
        : data.startsWith("data:image/png")
          ? "png"
          : "jpg";
    tx.set("imageBudget/global", {
      bytes: budget.bytes + data.length,
      counts: {
        ...budget.counts,
        [targetKey]: (budget.counts?.[targetKey] || 0) + 1,
      },
      rates: {
        ...budget.rates,
        [uid]: {
          at: timestamp - rate.at < 60000 ? rate.at : timestamp,
          count: timestamp - rate.at < 60000 ? rate.count + 1 : 1,
        },
      },
      lastImageId: imageId,
      updatedAt: timestamp,
    });
    await put(
      `images/${imageId}`,
      {
        targetId: request.targetId,
        targetType: type,
        eventId: row.eventId || (type === "events" ? request.targetId : null),
        assetId: row.assetId || request.targetId,
        dataUrl: data,
        bytes: data.length,
        purpose,
        width: request.width,
        height: request.height,
        order: list.length,
        filename: `${row.assetId || request.targetId}-${imageId}.${extension}`,
        expiresAt: purpose === "quick" ? timestamp + 90 * 86400000 : null,
        verified: false,
      },
      null,
    );
    out.id = imageId;
  } else if (op === "photoOrder") {
    need(user, "equipment.write");
    if (
      !["equipment", "cases", "crew", "maintenance", "events"].includes(
        request.targetType,
      )
    )
      no("Invalid image target.");
    if (request.targetType === "crew") need(user, "crew.write");
    if (
      !Array.isArray(request.filenames) ||
      request.filenames.length > 8 ||
      request.filenames.some(
        (n) => typeof n !== "string" || !/^[-\w]+\.(webp|png|jpe?g)$/.test(n),
      )
    )
      no("Invalid photo order.");
    const path = `${request.targetType}/${id(request.targetId)}`,
      row = await tx.get(path);
    if (!row) no("Target no longer exists.");
    await put(path, { ...row, photoOrder: request.filenames }, row);
  } else if (op === "imageOrder") {
    need(user, "equipment.write");
    if (!Array.isArray(request.ids) || request.ids.length > 8)
      no("Invalid image order.");
    for (const [order, imageId] of request.ids.entries()) {
      const p = `images/${id(imageId)}`,
        img = await tx.get(p);
      if (!img || img.targetId !== request.targetId)
        no("Image target mismatch.");
      await put(p, { ...img, order }, img);
    }
  } else if (op === "imageDelete") {
    need(user, "equipment.write");
    const p = `images/${id(request.id)}`,
      img = await tx.get(p);
    if (!img) no("Image no longer exists.");
    if (
      !request.discard &&
      img.purpose === "permanent" &&
      !privileged &&
      !(staticClient && request.publicationVerified === true)
    )
      no("Published-image cleanup requires server verification.");
    if (request.discard && !request.reason?.trim())
      no("Provide a reason to discard an unpublished image.");
    const budget = (await tx.get("imageBudget/global")) || {
      bytes: 0,
      counts: {},
      rates: {},
    };
    const key = `${img.targetType}_${img.targetId}`;
    tx.set("imageBudget/global", {
      ...budget,
      bytes: Math.max(0, budget.bytes - img.bytes),
      counts: {
        ...budget.counts,
        [key]: Math.max(0, (budget.counts[key] || 0) - 1),
      },
    });
    await remove(p);
  } else no("Unknown operation.");
  function allocation(goal) {
    return goal && !["Purchased", "Canceled"].includes(goal.status)
      ? goal.allocated || 0
      : 0;
  }
  async function adjustAllocated(delta) {
    const path = "financeTotals/global",
      totals = (await tx.get(path)) || { byKind: {}, allocated: 0 };
    await put(
      path,
      { ...totals, allocated: (totals.allocated || 0) + delta },
      totals.revision ? totals : null,
    );
  }
  async function updateLedgerTotals(before, after) {
    const paths = new Set([
      "financeTotals/global",
      ...(before?.eventId ? [`financeTotals/event_${before.eventId}`] : []),
      ...(after?.eventId ? [`financeTotals/event_${after.eventId}`] : []),
      ...(before?.crewId ? [`financeTotals/crew_${before.crewId}`] : []),
      ...(after?.crewId ? [`financeTotals/crew_${after.crewId}`] : []),
    ]);
    for (const path of paths) {
      const totals = (await tx.get(path)) || { byKind: {}, allocated: 0 },
        byKind = { ...totals.byKind };
      for (const [entry, sign] of [
        [before, -1],
        [after, 1],
      ])
        if (
          entry &&
          entry.status !== "Canceled" &&
          (path.endsWith("/global") ||
            path === `financeTotals/event_${entry.eventId}` ||
            path === `financeTotals/crew_${entry.crewId}`)
        )
          byKind[entry.kind] =
            (byKind[entry.kind] || 0) + sign * (entry.amount || 0);
      await put(path, { ...totals, byKind }, totals.revision ? totals : null);
    }
  }
  async function assertFunds() {
    const totals = (await tx.get("financeTotals/global")) || {
        byKind: {},
        allocated: 0,
      },
      summary = finances(
        Object.entries(totals.byKind || {}).map(([kind, amount]) => ({
          kind,
          amount,
        })),
      );
    if (summary.cash < 0)
      no(
        "This change would make recorded cash negative. Record opening funds or received revenue first.",
      );
    if (summary.cash < (totals.allocated || 0))
      no(
        "This change would spend funds already allocated to purchase goals. Reduce allocations first.",
      );
  }
  async function notify(uids, title, link) {
    if (staticClient && !user.owner && !permitted(user, "members.write"))
      return;
    for (const recipient of [...new Set(uids)].slice(0, 100)) {
      const member = await tx.get(`users/${recipient}`);
      if (member?.notificationPreferences?.operations === false) continue;
      tx.set(`notifications/${randomId()}`, {
        uid: recipient,
        title,
        link,
        read: false,
        createdAt: timestamp,
        revision: 1,
      });
    }
  }
  const auditId = randomId();
  const financial = changes.filter((c) =>
    /^(ledger|assetFinance|purchaseGoals|archiveFinance|financeTotals)\//.test(
      c.target,
    ),
  );
  const sensitive = changes.filter((c) => c.target.startsWith("crewPrivate/"));
  const regular = changes.filter(
    (c) => !financial.includes(c) && !sensitive.includes(c),
  );
  const log = {
    uid,
    userName: user.name || uid,
    action: op,
    reason: String(request.reason || "").slice(0, 2000),
    createdAt: timestamp,
    serverVerified: privileged,
    eventIds: [
      ...new Set(
        [
          request.eventId,
          ...changes
            .filter((c) => c.target.startsWith("events/"))
            .map((c) => c.target.split("/")[1]),
        ].filter(Boolean),
      ),
    ],
  };
  for (const [collection, items] of [
    ["activityLogs", regular],
    ["financeActivityLogs", financial],
    ["privateActivityLogs", sensitive],
  ])
    if (items.length) {
      const parts = [];
      let chunk = [],
        bytes = 0;
      for (const item of items) {
        const size = JSON.stringify(item).length;
        if (bytes + size > 400000 && chunk.length) {
          parts.push(chunk);
          chunk = [];
          bytes = 0;
        }
        chunk.push(item);
        bytes += size;
      }
      if (chunk.length) parts.push(chunk);
      for (const [index, changes] of parts.entries())
        tx.set(
          `${collection}/${parts.length === 1 ? auditId : auditId + "_" + index}`,
          {
            ...log,
            operationId: auditId,
            part: index + 1,
            parts: parts.length,
            targets: changes.map((c) => c.target),
            changes,
          },
        );
    }
  tx.set(`requests/${uid}_${requestId}`, {
    uid,
    result: out,
    createdAt: timestamp,
    expiresAt: timestamp + 7 * 86400000,
  });
  return out;
}
function redact(row) {
  if (!row) return null;
  const copy = { ...row };
  delete copy.dataUrl;
  if (copy.songs) copy.songs = { count: copy.songs.length };
  for (const field of [
    "assignments",
    "caseAssignments",
    "roster",
    "tasks",
    "rig",
    "setlists",
    "rundown",
    "maintenance",
    "ledger",
    "plan",
  ])
    if (copy[field] && typeof copy[field] === "object")
      copy[field] = {
        count: Array.isArray(copy[field])
          ? copy[field].length
          : Object.keys(copy[field]).length,
      };
  if (copy.snapshot) delete copy.snapshot;
  return copy;
}
