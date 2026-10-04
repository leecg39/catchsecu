import { randomUUID } from "node:crypto";
import { runOneDestruction } from "../src/server/destruction-worker";
console.log(JSON.stringify(await runOneDestruction(randomUUID())));
process.exit(0);
