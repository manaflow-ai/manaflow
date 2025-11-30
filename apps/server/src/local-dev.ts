import { startServer } from "./server";

await startServer({
  port: parseInt(process.env.PORT || "9776"),
});
