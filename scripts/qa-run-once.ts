import { runOneJob } from "../src/server/jobs";
(async () => { console.log("ran:", await runOneJob("qa-manual")); })();
