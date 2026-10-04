import { enqueueExpiredSubmissions } from "../src/server/destruction-worker";
const result = await enqueueExpiredSubmissions();
console.log(JSON.stringify(result));
process.exit(0);
