import * as data from "./data.js";
export async function refreshMaintenance() {
  if (!data.session().user?.owner) throw Error("Owner access is required.");
  const events = (await data.list("events", { size: 100 })).rows.filter(
    (e) => e.status !== "Archived",
  );
  const emit = (uid, key, title, link) =>
    data.operate({ op: "notificationGenerate", uid, key, title, link });
  for (const event of events) {
    for (const uid of event.memberUids || [])
      await emit(
        uid,
        `event_${event.id}_${event.revision}`,
        `Event updated: ${event.name}`,
        `#/events/${event.id}`,
      );
    const tasks = (await data.list(`events/${event.id}/tasks`, { size: 200 }))
      .rows;
    for (const task of tasks) {
      if (!task.assigneeId || task.status === "Complete") continue;
      const link = await data.get(`accountLinks/${task.assigneeId}`);
      if (link?.active && event.memberUids?.includes(link.uid))
        await emit(
          link.uid,
          `task_${event.id}_${task.id}_${task.revision}`,
          `Task assigned: ${task.name}`,
          `#/events/${event.id}?tab=tasks`,
        );
    }
    const equipment = (
      await data.list("equipment", {
        filters: [["eventId", "==", event.id]],
        size: 200,
      })
    ).rows;
    for (const item of equipment.filter((i) =>
      ["Missing", "Unsafe", "Damaged"].includes(i.condition),
    ))
      for (const uid of event.memberUids || [])
        await emit(
          uid,
          `issue_${item.id}_${item.revision}`,
          `${item.condition} equipment: ${item.assetId}`,
          `#/equipment/${item.id}`,
        );
  }
  const today = new Date().toISOString().slice(0, 10),
    tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  for (const event of events)
    if (event.date >= today && event.date <= tomorrow)
      for (const uid of event.memberUids || [])
        await emit(
          uid,
          `upcoming_${event.id}_${today}`,
          `Upcoming event: ${event.name}`,
          `#/events/${event.id}`,
        );
  const issues = (await data.list("maintenance", { size: 100 })).rows.filter(
    (i) =>
      i.inspectionDate &&
      i.inspectionDate <= today &&
      !["Resolved", "Retired"].includes(i.status),
  );
  for (const issue of issues)
    await emit(
      data.session().user.id,
      `inspection_${issue.id}_${issue.inspectionDate}`,
      `Inspection due: ${issue.name}`,
      `#/maintenance/${issue.id}`,
    );
  const photos = (
    await data.list("images", {
      filters: [["purpose", "==", "quick"]],
      size: 100,
    })
  ).rows;
  let expired = 0;
  for (const image of photos)
    if (image.expiresAt && image.expiresAt <= Date.now()) {
      await data.operate({ op: "imageExpire", id: image.id });
      expired++;
    }
  const bookkeeping = await data.cleanupBookkeeping();
  return { events: events.length, expired, bookkeeping };
}
