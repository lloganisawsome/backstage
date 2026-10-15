export const permissions = [
  "operations.read",
  "equipment.write",
  "events.write",
  "crew.read",
  "crew.write",
  "clients.read",
  "clients.write",
  "maintenance.write",
  "finance.read",
  "finance.write",
  "settings.write",
  "members.write",
  "audit.read",
  "dependencies.override",
  "tasks.complete",
  "equipment.status",
  "cases.verify",
  "rig.update",
  "setlists.perform",
];
export const roleDefaults = {
  Owner: Object.fromEntries(permissions.map((p) => [p, true])),
  Administrator: Object.fromEntries(
    permissions
      .filter(
        (p) => !["members.write", "finance.read", "finance.write"].includes(p),
      )
      .map((p) => [p, true]),
  ),
  "Event Manager": {
    "events.write": true,
    "maintenance.write": true,
    "crew.read": true,
    "clients.read": true,
    "tasks.complete": true,
    "equipment.status": true,
    "cases.verify": true,
    "rig.update": true,
    "setlists.perform": true,
  },
  Crew: {
    "maintenance.write": true,
    "tasks.complete": true,
    "equipment.status": true,
    "cases.verify": true,
    "rig.update": true,
    "setlists.perform": true,
  },
  Viewer: {},
};
export const categories = [
  "Audio",
  "Lighting",
  "Rigging",
  "Trussing",
  "DMX",
  "Power",
  "Cables",
  "Video",
  "Computers",
  "Controllers",
  "Accessories",
  "Tools",
  "Miscellaneous",
];
export const stages = [
  "Available",
  "Reserved",
  "Packed",
  "Loaded",
  "In transit",
  "Unloaded",
  "Installed",
  "Rigged",
  "In use",
  "Struck",
  "Returned",
];
export const conditions = [
  "Good",
  "Needs inspection",
  "Damaged",
  "Under repair",
  "Missing",
  "Unsafe",
  "Retired",
];
export const eventStates = [
  "Draft",
  "Planning",
  "Confirmed",
  "Preparing",
  "Loading",
  "In transit",
  "Setting up",
  "Ready",
  "Live",
  "Striking",
  "Loading out",
  "Completed",
  "Archived",
  "Canceled",
];
const f = (key, label, type = "text", extra = {}) => ({
  key,
  label,
  type,
  ...extra,
});
const choice = (key, label, options) => f(key, label, "select", { options });
const ref = (key, label, collection, multiple = false) =>
  f(key, label, multiple ? "refs" : "ref", { collection });
export const schemas = {
  equipment: {
    label: "Equipment",
    singular: "Equipment",
    write: "equipment.write",
    fields: [
      f("assetId", "Asset ID", "text", { required: true }),
      f("name", "Equipment name", "text", { required: true }),
      choice("category", "Category", categories),
      f("manufacturer", "Manufacturer"),
      f("model", "Model"),
      f("serial", "Serial number"),
      f("description", "Description", "textarea"),
      f("purchaseDate", "Purchase date", "date"),
      choice("condition", "Condition", conditions),
      f("location", "Location"),
      f("notes", "Notes", "textarea"),
      f("tags", "Tags (comma separated)"),
    ],
    columns: ["assetId", "name", "category", "condition", "stage", "location"],
  },
  cases: {
    label: "Road cases",
    singular: "Road Case",
    write: "equipment.write",
    fields: [
      f("assetId", "Case ID", "text", { required: true }),
      f("name", "Case name", "text", { required: true }),
      choice("category", "Category", categories),
      f("description", "Description", "textarea"),
      f("location", "Location"),
      choice("condition", "Condition", conditions),
      f("notes", "Notes", "textarea"),
    ],
    columns: ["assetId", "name", "category", "stage", "location"],
  },
  events: {
    label: "Events",
    singular: "Event",
    write: "events.write",
    fields: [
      f("name", "Event name", "text", { required: true }),
      ref("clientId", "Client", "clients"),
      f("venue", "Venue"),
      f("address", "Address"),
      f("date", "Event date", "date", { required: true }),
      f("startTime", "Start time", "time"),
      f("endTime", "End time", "time"),
      f("crewCall", "Crew call", "time"),
      f("loadIn", "Load-in", "time"),
      f("setupDeadline", "Setup deadline", "time"),
      f("soundcheck", "Soundcheck", "time"),
      f("strike", "Strike", "time"),
      f("loadOut", "Load-out deadline", "time"),
      choice(
        "status",
        "Status",
        eventStates.filter((s) => s !== "Archived"),
      ),
      f("notes", "Notes", "textarea"),
    ],
    columns: ["name", "date", "venue", "status"],
  },
  crew: {
    label: "Crew",
    singular: "Crew Member",
    write: "crew.write",
    read: "crew.read",
    fields: [
      f("assetId", "Crew ID", "text", { required: true }),
      f("name", "Name", "text", { required: true }),
      f("roles", "Production roles (comma separated)"),
      f("qualifications", "Equipment qualifications", "textarea"),
      f("training", "Training records", "textarea"),
      f("notes", "Operational notes", "textarea"),
    ],
    columns: ["assetId", "name", "roles", "qualifications"],
  },
  crewPrivate: {
    label: "Private crew details",
    write: "crew.write",
    read: "crew.write",
    fields: [
      ref("crewId", "Crew member", "crew"),
      f("name", "Name"),
      f("email", "Email", "email"),
      f("phone", "Phone"),
      f("notes", "Private notes", "textarea"),
    ],
    columns: ["name", "email", "phone"],
  },
  clients: {
    label: "Clients & schools",
    singular: "Client",
    write: "clients.write",
    read: "clients.read",
    fields: [
      f("name", "Client name", "text", { required: true }),
      choice("type", "Type", ["School", "Organization", "Business", "Private"]),
      f("contact", "Contact"),
      f("email", "Email", "email"),
      f("phone", "Phone"),
      f("genres", "Preferred genres"),
      f("artists", "Favorite artists"),
      f("popularSongs", "Popular songs", "textarea"),
      f("doNotPlay", "Do not play", "textarea"),
      f("restrictions", "Restrictions", "textarea"),
      f("preferences", "Event preferences", "textarea"),
      ref("preferredEquipment", "Preferred equipment", "equipment", true),
      f("notes", "Notes", "textarea"),
    ],
    columns: ["name", "type", "contact", "email"],
  },
  maintenance: {
    label: "Maintenance",
    singular: "Issue",
    write: "maintenance.write",
    fields: [
      f("name", "Issue title", "text", { required: true }),
      ref("equipmentId", "Equipment", "equipment"),
      ref("eventId", "Event", "events"),
      choice("severity", "Severity", ["Low", "Medium", "High", "Critical"]),
      choice("status", "Status", [
        "Reported",
        "Needs inspection",
        "Under investigation",
        "Awaiting parts",
        "Under repair",
        "Resolved",
        "Retired",
      ]),
      ref("technicianId", "Technician", "crew"),
      f("inspectionDate", "Next inspection", "date"),
      f("description", "Description", "textarea"),
      f("repairNotes", "Repair notes", "textarea"),
    ],
    columns: ["name", "equipmentId", "severity", "status", "inspectionDate"],
  },
  purchaseGoals: {
    label: "Purchase planning",
    singular: "Purchase Goal",
    write: "finance.write",
    read: "finance.read",
    fields: [
      f("name", "Equipment name", "text", { required: true }),
      choice("category", "Category", categories),
      f("manufacturer", "Manufacturer"),
      f("model", "Model"),
      f("price", "Unit price", "money"),
      f("quantity", "Quantity", "number", { min: 1, max: 100, default: 1 }),
      choice("priority", "Priority", ["Low", "Normal", "High", "Urgent"]),
      f("reason", "Purchase reason", "textarea"),
      f("vendor", "Vendor reference", "url"),
      f("targetDate", "Target date", "date"),
      choice("status", "Status", [
        "Goal",
        "Saving",
        "Planned",
        "Purchased",
        "Canceled",
      ]),
      f("notes", "Notes", "textarea"),
    ],
    columns: ["name", "quantity", "price", "priority", "status", "allocated"],
  },
  ledger: {
    label: "Finances",
    singular: "Ledger Entry",
    write: "finance.write",
    read: "finance.read",
    fields: [
      f("name", "Description", "text", { required: true }),
      ref("eventId", "Event", "events"),
      choice("kind", "Type", [
        "Opening funds",
        "Revenue quoted",
        "Revenue agreed",
        "Revenue expected",
        "Revenue invoiced",
        "Revenue received",
        "Expense expected",
        "Expense paid",
        "Crew obligation",
        "Crew payment",
      ]),
      ref("crewId", "Crew member", "crew"),
      f("amount", "Amount", "money", { required: true }),
      f("date", "Date", "date"),
      f("method", "Payment method"),
      choice("status", "Approval", ["Pending", "Approved", "Paid", "Canceled"]),
      f("notes", "Notes / correction reason", "textarea"),
    ],
    columns: ["name", "kind", "amount", "date", "status"],
  },
  assetFinance: {
    label: "Equipment costs",
    singular: "Equipment Cost",
    write: "finance.write",
    read: "finance.read",
    fields: [
      ref("equipmentId", "Equipment", "equipment"),
      f("name", "Asset description"),
      f("purchasePrice", "Purchase price", "money"),
      f("replacementCost", "Replacement cost", "money"),
    ],
    columns: ["name", "purchasePrice", "replacementCost"],
  },
  songs: {
    label: "Song library",
    singular: "Song",
    write: "events.write",
    fields: [
      f("name", "Song title", "text", { required: true }),
      f("artist", "Artist"),
      f("duration", "Duration (seconds)", "number"),
      f("genre", "Genre"),
      f("bpm", "BPM", "number"),
      f("key", "Key"),
      f("source", "External source", "url"),
      f("notes", "Notes", "textarea"),
    ],
    columns: ["name", "artist", "duration", "genre", "bpm"],
  },
  templates: {
    label: "Templates",
    singular: "Template",
    write: "settings.write",
    fields: [
      f("name", "Template name", "text", { required: true }),
      choice("type", "Template type", ["Event", "Label", "Badge", "Setlist"]),
      f("notes", "Notes", "textarea"),
    ],
    columns: ["name", "type"],
  },
  tasks: {
    label: "Tasks",
    singular: "Task",
    event: true,
    fields: [
      f("name", "Task name", "text", { required: true }),
      f("description", "Description", "textarea"),
      choice("phase", "Phase", [
        "Preparation",
        "Loading",
        "Arrival",
        "Setup",
        "Strike",
        "Load-out",
        "Return",
      ]),
      f("category", "Category"),
      ref("assigneeId", "Assigned crew", "crew"),
      choice("priority", "Priority", ["Low", "Normal", "High", "Urgent"]),
      f("due", "Due time", "datetime-local"),
      f("dependencies", "Dependency task IDs (comma separated)"),
      ref("equipmentId", "Related equipment", "equipment"),
      ref("caseId", "Related case", "cases"),
      f("notes", "Notes", "textarea"),
    ],
    columns: ["name", "phase", "assigneeId", "priority", "status"],
  },
  documents: {
    label: "Documents",
    singular: "Document Link",
    event: true,
    fields: [
      f("name", "Document name", "text", { required: true }),
      f("url", "Document URL", "url", { required: true }),
      f("notes", "Notes", "textarea"),
    ],
    columns: ["name", "url"],
  },
  rundown: {
    label: "Run of show",
    singular: "Segment",
    event: true,
    fields: [
      f("name", "Segment name", "text", { required: true }),
      f("startTime", "Planned start", "time"),
      f("duration", "Duration (minutes)", "number"),
      ref("crewId", "Responsible crew", "crew"),
      ref("equipmentId", "Equipment", "equipment"),
      f("description", "Description", "textarea"),
      f("notes", "Notes", "textarea"),
    ],
    columns: ["startTime", "name", "duration", "actualTime", "status"],
  },
  setlists: {
    label: "Setlists",
    singular: "Setlist",
    event: true,
    fields: [
      f("name", "Setlist name", "text", { required: true }),
      f("notes", "Notes", "textarea"),
    ],
    columns: ["name"],
  },
  rig: {
    label: "Rig layout",
    singular: "Rig Position",
    event: true,
    fields: [
      f("name", "Position name", "text", { required: true }),
      f("section", "Section"),
      ref("equipmentId", "Equipment", "equipment"),
      ref("crewId", "Assigned crew", "crew"),
      f("x", "X position", "number"),
      f("y", "Y position", "number"),
      f("notes", "Notes", "textarea"),
    ],
    columns: ["name", "section", "equipmentId", "state"],
  },
};
export function permitted(user, p) {
  return !!(user?.active && (user.owner || user.permissions?.[p]));
}
export function cents(value) {
  const s = String(value ?? "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s))
    throw Error("Enter a non-negative amount with at most two decimal places.");
  const [a, b = ""] = s.split(".");
  const n = Number(a) * 100 + Number(b.padEnd(2, "0"));
  if (!Number.isSafeInteger(n) || n > 100_000_000_00)
    throw Error("Amount is too large.");
  return n;
}
export function money(n) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format((n || 0) / 100);
}
export function finances(rows) {
  const total = (k) =>
    rows
      .filter((r) => r.kind === k && r.status !== "Canceled")
      .reduce((a, r) => a + (r.amount || 0), 0);
  const received = total("Revenue received"),
    paid = total("Expense paid") + total("Crew payment");
  return {
    quoted: total("Revenue quoted"),
    agreed: total("Revenue agreed"),
    expected: total("Revenue expected") || total("Revenue agreed"),
    invoiced: total("Revenue invoiced"),
    received,
    expensesExpected: total("Expense expected") + total("Crew obligation"),
    expensesPaid: paid,
    outstanding: Math.max(0, total("Revenue invoiced") - received),
    crewDue: Math.max(0, total("Crew obligation") - total("Crew payment")),
    estimated:
      (total("Revenue expected") || total("Revenue agreed")) -
      total("Expense expected") -
      total("Crew obligation"),
    realized: received - paid,
    cash: total("Opening funds") + received - paid,
  };
}
export function validate(type, input) {
  const schema = schemas[type];
  if (!schema) throw Error("Unknown record type.");
  const result = {};
  for (const field of schema.fields) {
    let v = input[field.key];
    if (v == null || v === "") {
      if (field.required) throw Error(`${field.label} is required.`);
      continue;
    }
    if (field.type === "refs") {
      if (
        !Array.isArray(v) ||
        v.length > 100 ||
        v.some((x) => typeof x !== "string" || !/^[-\w]{1,100}$/.test(x))
      )
        throw Error("Invalid reference list.");
      result[field.key] = v;
      continue;
    }
    if (["money", "number"].includes(field.type)) {
      if (
        !Number.isSafeInteger(v) ||
        v < 0 ||
        v > (field.type === "money" ? 100_000_000_00 : 1000000)
      )
        throw Error(`${field.label} is invalid.`);
      if (field.min != null && v < field.min)
        throw Error(`${field.label} must be at least ${field.min}.`);
      if (field.max != null && v > field.max)
        throw Error(`${field.label} must be at most ${field.max}.`);
    } else {
      if (typeof v !== "string" || v.length > 8000)
        throw Error(`${field.label} is too long.`);
      v = v.trim();
      if (
        field.type === "select" &&
        field.key !== "category" &&
        !field.options.includes(v)
      )
        throw Error(`Invalid ${field.label}.`);
      if (field.type === "ref" && !/^[-\w]{1,100}$/.test(v))
        throw Error("Invalid reference.");
      if (field.type === "url" && !/^https?:\/\//i.test(v))
        throw Error("Use an http or https URL.");
      if (
        field.type === "date" &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(v) ||
          !Number.isFinite(Date.parse(v + "T00:00:00Z")) ||
          new Date(v + "T00:00:00Z").toISOString().slice(0, 10) !== v)
      )
        throw Error("Invalid date.");
      if (
        field.type === "time" &&
        (!/^\d{2}:\d{2}$/.test(v) ||
          Number(v.slice(0, 2)) > 23 ||
          Number(v.slice(3)) > 59)
      )
        throw Error("Invalid time.");
    }
    result[field.key] = v;
  }
  if (result.assetId && !/^[A-Z0-9][A-Z0-9-]{1,48}$/.test(result.assetId))
    throw Error("Use an uppercase asset ID with letters, digits, and hyphens.");
  result.nameKey = (result.name || "").toLowerCase();
  return result;
}
