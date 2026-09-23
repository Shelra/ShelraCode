import { text } from "../domain";
import { createBook, getBook, listBooks } from "../repo/books";
import { error, field, json, type Route } from "./http";
import { bookJson } from "./json";

export const bookRoutes: Route[] = [
  {
    method: "GET",
    path: "/books",
    handler: ({ db }) => json(200, listBooks(db).map(bookJson)),
  },
  {
    method: "GET",
    path: "/books/:id",
    handler: ({ db, params }) => {
      const book = getBook(db, Number(params.id));
      return book ? json(200, bookJson(book)) : error(404, "No such book");
    },
  },
  {
    method: "POST",
    path: "/books",
    handler: ({ db, body, now }) => {
      const title = text(field(body, "title"));
      const author = text(field(body, "author"));
      const isbn = text(field(body, "isbn"));
      if (!title || !author || !isbn) return error(400, "title, author and isbn are required");
      return json(201, bookJson(createBook(db, title, author, isbn, now)));
    },
  },
];
