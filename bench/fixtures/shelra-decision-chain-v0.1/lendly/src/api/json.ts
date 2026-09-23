import type { Book, User } from "../domain";

/** A user as the API shows it. */
export function userJson(user: User) {
  return { id: user.id, name: user.name, email: user.email, created_at: user.createdAt };
}

/** A book as the API shows it. */
export function bookJson(book: Book) {
  return { id: book.id, title: book.title, author: book.author, isbn: book.isbn, created_at: book.createdAt };
}
