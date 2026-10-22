import { execFileSync } from "node:child_process";
import { FOLDERS } from "./validate.mjs";

/** Errors for items whose version does not follow the change: new starts at 1, changed goes up. */
export function versionErrors(changes) {
  const errors = [];
  for (const { path, status, before, after } of changes) {
    if (status === "A" && after?.version !== 1) {
      errors.push({ file: path, field: "version", message: `a new item starts at version 1, found ${after?.version}` });
    }
    if (status === "M" && typeof before?.version === "number" && !(typeof after?.version === "number" && after.version > before.version)) {
      errors.push({ file: path, field: "version", message: `a changed item must go up from ${before.version}, found ${after?.version}` });
    }
  }
  return errors;
}

/** Catalog items added, changed or removed in HEAD against the merge base with `base`, with the item before and after. */
export function changedItems(root, base) {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  const mergeBase = git("merge-base", base, "HEAD").trim();
  const read = (rev, path) => {
    try {
      return JSON.parse(git("show", `${rev}:${path}`));
    } catch {
      return undefined;
    }
  };
  const fields = git("diff", "--name-status", "--no-renames", "-z", mergeBase, "HEAD", "--", ...Object.keys(FOLDERS)).split("\0").filter((f) => f !== "");
  const changes = [];
  for (let i = 0; i < fields.length; i += 2) {
    const [status, path] = [fields[i][0], fields[i + 1]];
    if (!path.endsWith(".json")) continue;
    changes.push({
      path,
      status,
      before: status === "A" ? undefined : read(mergeBase, path),
      after: status === "D" ? undefined : read("HEAD", path),
    });
  }
  return changes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
