import { isEmail, text } from "../domain";
import { log } from "../log";
import { createUser, findUserByEmail, getUser, listUsers } from "../repo/users";
import { error, field, json, type Route } from "./http";
import { userJson } from "./json";

export const userRoutes: Route[] = [
  {
    method: "GET",
    path: "/users",
    handler: ({ db }) => json(200, listUsers(db).map(userJson)),
  },
  {
    method: "GET",
    path: "/users/:id",
    handler: ({ db, params }) => {
      const user = getUser(db, Number(params.id));
      return user ? json(200, userJson(user)) : error(404, "No such user");
    },
  },
  {
    method: "POST",
    path: "/users",
    handler: ({ db, body, now }) => {
      const name = text(field(body, "name"));
      const email = field(body, "email");
      if (!name) return error(400, "name is required");
      if (!isEmail(email)) return error(400, "email must be an email address");
      if (findUserByEmail(db, email)) return error(409, "That email is already registered");
      const user = createUser(db, name, email, now);
      log("user.created", { user_id: user.id });
      return json(201, userJson(user));
    },
  },
];
