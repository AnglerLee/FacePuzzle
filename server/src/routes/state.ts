import { assertRate } from "../_server/guard";
import { getState } from "../_server/store";
import { json } from "./handle";

export async function GET(req: Request): Promise<Response> {
  assertRate(req, "state");
  return json(await getState());
}
