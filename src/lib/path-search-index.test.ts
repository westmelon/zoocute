import { describe, expect, it } from "vitest";
import { PathSearchIndex, toCachedNodeFromSnapshot } from "./path-search-index";

describe("PathSearchIndex", () => {
  it("tracks direct children without scanning the full index", () => {
    const index = new PathSearchIndex();
    index.insert(
      toCachedNodeFromSnapshot({
        path: "/a",
        name: "a",
        parentPath: "/",
        hasChildren: true,
      })
    );
    index.insert(
      toCachedNodeFromSnapshot({
        path: "/a/child",
        name: "child",
        parentPath: "/a",
        hasChildren: false,
      })
    );
    index.insert(
      toCachedNodeFromSnapshot({
        path: "/b/other",
        name: "other",
        parentPath: "/b",
        hasChildren: false,
      })
    );

    expect(index.childPaths("/a")).toEqual(["/a/child"]);

    index.removeChildren("/a");

    expect(index.childPaths("/a")).toEqual([]);
    expect(index.search("child")).toEqual([]);
    expect(index.search("other").map((node) => node.path)).toEqual(["/b/other"]);
  });

  it("tracks direct children inserted in batches", () => {
    const index = new PathSearchIndex();
    index.insertMany([
      toCachedNodeFromSnapshot({
        path: "/configs/feature-a",
        name: "feature-a",
        parentPath: "/configs",
        hasChildren: true,
      }),
    ]);

    expect(index.childPaths("/configs")).toEqual(["/configs/feature-a"]);
  });

  it("updates parent indexes when an existing node moves parent", () => {
    const index = new PathSearchIndex();
    index.insert(
      toCachedNodeFromSnapshot({
        path: "/moved",
        name: "moved",
        parentPath: "/old",
        hasChildren: false,
      })
    );
    index.insert(
      toCachedNodeFromSnapshot({
        path: "/moved",
        name: "moved",
        parentPath: "/new",
        hasChildren: false,
      })
    );

    expect(index.childPaths("/old")).toEqual([]);
    expect(index.childPaths("/new")).toEqual(["/moved"]);
  });

  it("removes descendants when removing stale children for a refreshed parent", () => {
    const index = new PathSearchIndex();
    index.insert(toCachedNodeFromSnapshot({ path: "/configs", name: "configs", parentPath: "/", hasChildren: true }));
    index.insert(toCachedNodeFromSnapshot({ path: "/configs/feature-a", name: "feature-a", parentPath: "/configs", hasChildren: true }));
    index.insert(toCachedNodeFromSnapshot({ path: "/configs/feature-a/detail", name: "detail", parentPath: "/configs/feature-a", hasChildren: false }));

    for (const childPath of index.childPaths("/configs")) {
      index.removeSubtree(childPath);
    }
    index.removeChildren("/configs");
    index.insert(toCachedNodeFromSnapshot({ path: "/configs/feature-b", name: "feature-b", parentPath: "/configs", hasChildren: false }));

    expect(index.search("detail")).toEqual([]);
    expect(index.search("feature-b").map((node) => node.path)).toEqual(["/configs/feature-b"]);
  });
});
