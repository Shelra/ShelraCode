import { describe, expect, it } from "bun:test";
import { openDatabase } from "../db";
import { handle } from "./router";

const now = new Date("2026-09-01T10:00:00.000Z");
const dune = { title: "Dune", author: "Frank Herbert", isbn: "9780441172719" };

describe("books", () => {
  it("adds a book and lists it", () => {
    const db = openDatabase();
    const created = handle(db, { method: "POST", path: "/books", body: dune }, now);
    expect(created.status).toBe(201);
    const book = { id: 1, ...dune, created_at: now.toISOString() };
    expect(created.body).toMatchObject(book);
    expect(handle(db, { method: "GET", path: "/books/1" }, now).body).toMatchObject(book);
    const listed = handle(db, { method: "GET", path: "/books" }, now).body as unknown[];
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject(book);
  });

  it("rejects a book without a title, an author or an isbn", () => {
    const db = openDatabase();
    for (const missing of ["title", "author", "isbn"]) {
      const body = { ...dune, [missing]: " " };
      expect(handle(db, { method: "POST", path: "/books", body }, now).status).toBe(400);
    }
  });

  it("answers 404 for a book that does not exist", () => {
    expect(handle(openDatabase(), { method: "GET", path: "/books/3" }, now).status).toBe(404);
  });
});
