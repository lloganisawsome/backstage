// Backstage shares Firebase identities, while keeping its records separate from public-site profiles.
export const backstageRoot = "backstage/main";
export const ownerEmail = "loganstatham76@gmail.com";
export const backstageAppName = "sn-productions-backstage";
export function scopeFirestore(sdk) {
  return {
    ...sdk,
    doc: (db, ...segments) => sdk.doc(db, backstageRoot, ...segments),
    collection: (db, ...segments) =>
      sdk.collection(db, backstageRoot, ...segments),
  };
}
export async function ensureOwnerMembership(sdk, db, account) {
  if (!account?.emailVerified || account.email?.toLowerCase() !== ownerEmail)
    return;
  const ref = sdk.doc(db, "users", account.uid);
  await sdk.runTransaction(db, async (tx) => {
    if ((await tx.get(ref)).exists()) return;
    tx.set(ref, {
      name: account.displayName || "Logan Statham",
      email: ownerEmail,
      active: true,
      owner: true,
      roles: ["Owner"],
      permissions: {},
      revision: 1,
      createdAt: sdk.serverTimestamp(),
      updatedAt: sdk.serverTimestamp(),
      updatedBy: account.uid,
    });
  });
}
