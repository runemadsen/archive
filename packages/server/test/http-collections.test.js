import assert from "node:assert/strict";
import { test } from "node:test";

import { createUser } from "../src/lib/auth/users.js";
import { startTestApp } from "./helpers/server.js";

async function login(app) {
  await createUser(app.db, { email: "r@example.com", password: "supersecret" });
  await app.post("/api/login", {
    email: "r@example.com",
    password: "supersecret",
  });
}

test("collections CRUD + membership over HTTP", async () => {
  const app = await startTestApp();
  try {
    await login(app);

    // Create a tree: A > B
    const a = (await app.post("/api/collections", { name: "A" })).json
      .collection;
    const b = (
      await app.post("/api/collections", { name: "B", parentId: a.id })
    ).json.collection;
    assert.equal(b.parent_id, a.id);

    // Upload a file and add it to B via the bulk endpoint (single-id array).
    const file = (
      await app.upload("/api/files", {
        filename: "x.txt",
        contentType: "text/plain",
        body: "x",
      })
    ).json.file;
    assert.equal(
      (await app.post(`/api/collections/${b.id}/files`, { fileIds: [file.id] }))
        .status,
      200,
    );
    assert.deepEqual(
      (await app.get(`/api/files/${file.id}/collections`)).json.collectionIds,
      [b.id],
    );

    // List shows descendant-inclusive counts (A counts B's file).
    const list = (await app.get("/api/collections")).json.collections;
    const byId = Object.fromEntries(list.map((c) => [c.id, c.fileCount]));
    assert.equal(byId[a.id], 1);
    assert.equal(byId[b.id], 1);

    // Filtering by A's name (descendant-inclusive) finds the file in B.
    assert.equal(
      (await app.get("/api/search?q=" + encodeURIComponent("collection=A")))
        .json.total,
      1,
    );

    // Remove membership -> filter empty (bulk DELETE with a JSON body).
    await app.del(`/api/collections/${b.id}/files`, {
      body: { fileIds: [file.id] },
    });
    assert.equal(
      (await app.get("/api/search?q=" + encodeURIComponent("collection=A")))
        .json.total,
      0,
    );
  } finally {
    await app.close();
  }
});

test("bulk membership: many files added/removed in one request", async () => {
  const app = await startTestApp();
  try {
    await login(app);
    const c = (await app.post("/api/collections", { name: "Trips" })).json
      .collection;
    const ids = [];
    for (const name of ["a.txt", "b.txt", "c.txt"]) {
      ids.push(
        (
          await app.upload("/api/files", {
            filename: name,
            contentType: "text/plain",
            body: name,
          })
        ).json.file.id,
      );
    }

    // Add all three at once.
    const added = await app.post(`/api/collections/${c.id}/files`, {
      fileIds: ids,
    });
    assert.equal(added.status, 200);
    assert.equal(added.json.count, 3);
    for (const id of ids) {
      assert.deepEqual(
        (await app.get(`/api/files/${id}/collections`)).json.collectionIds,
        [c.id],
      );
    }
    assert.equal(
      (await app.get("/api/collections")).json.collections.find(
        (x) => x.id === c.id,
      ).fileCount,
      3,
    );

    // Remove two at once; one remains.
    assert.equal(
      (
        await app.del(`/api/collections/${c.id}/files`, {
          body: { fileIds: [ids[0], ids[1]] },
        })
      ).status,
      200,
    );
    assert.equal(
      (await app.get("/api/collections")).json.collections.find(
        (x) => x.id === c.id,
      ).fileCount,
      1,
    );

    // Empty / missing fileIds is a 400.
    assert.equal(
      (await app.post(`/api/collections/${c.id}/files`, { fileIds: [] }))
        .status,
      400,
    );
    // Unknown collection is a 404.
    assert.equal(
      (await app.post("/api/collections/9999/files", { fileIds: [ids[2]] }))
        .status,
      404,
    );
  } finally {
    await app.close();
  }
});

test("PATCH renames/moves; cycle rejected; DELETE cascades", async () => {
  const app = await startTestApp();
  try {
    await login(app);
    const a = (await app.post("/api/collections", { name: "A" })).json
      .collection;
    const b = (
      await app.post("/api/collections", { name: "B", parentId: a.id })
    ).json.collection;

    // rename
    assert.equal(
      (
        await app.req("PATCH", `/api/collections/${b.id}`, {
          body: { name: "B2" },
        })
      ).json.collection.name,
      "B2",
    );
    // move B2 to root
    assert.equal(
      (
        await app.req("PATCH", `/api/collections/${b.id}`, {
          body: { parentId: null },
        })
      ).json.collection.parent_id,
      null,
    );
    // cycle: make A a child of B2 (now B2 is root, A under... try moving A under B2 then B2 under A)
    await app.req("PATCH", `/api/collections/${a.id}`, {
      body: { parentId: b.id },
    });
    assert.equal(
      (
        await app.req("PATCH", `/api/collections/${b.id}`, {
          body: { parentId: a.id },
        })
      ).status,
      400,
    );

    // delete B2 cascades A (its child now)
    assert.equal((await app.del(`/api/collections/${b.id}`)).status, 200);
    assert.equal(
      (await app.get("/api/collections")).json.collections.length,
      0,
    );
  } finally {
    await app.close();
  }
});
