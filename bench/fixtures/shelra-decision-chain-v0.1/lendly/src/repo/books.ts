import type { Database } from "bun:sqlite";
import type { Book } from "../domain";

interface BookRow {
  id: number;
  title: string;
  author: string;
  isbn: string;
  created_at: string;
}

function toBook(row: BookRow): Book {
  return { id: row.id, title: row.title, author: row.author, isbn: row.isbn, createdAt: row.created_at };
}

export function listBooks(db: Database): Book[] {
  return (db.query("SELECT id, title, author, isbn, created_at FROM books ORDER BY id").all() as BookRow[]).map(toBook);
}

export function getBook(db: Database, id: number): Book | undefined {
  const row = db.query("SELECT id, title, author, isbn, created_at FROM books WHERE id = ?").get(id) as BookRow | null;
  return row ? toBook(row) : undefined;
}

export function createBook(db: Database, title: string, author: string, isbn: string, now: Date): Book {
  const row = db
    .query(
      "INSERT INTO books (title, author, isbn, created_at) VALUES (?, ?, ?, ?) RETURNING id, title, author, isbn, created_at",
    )
    .get(title, author, isbn, now.toISOString()) as BookRow;
  return toBook(row);
}
