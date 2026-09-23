# @acme/users-client

The client other services use to read users.

```ts
import { fetchUsr, listUsers } from "@acme/users-client";

const user = fetchUsr("u1"); // { id: "u1", name: "Ada" }
const everyone = listUsers();
```
