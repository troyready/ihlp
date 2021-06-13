import { mergeObjIntoEnv } from "./util";

describe("utility tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("mergeObjIntoEnv accepts empty object and returns current environment", async () => {
    const origEnv = process.env;
    const mergedEnvVars = mergeObjIntoEnv({});
    expect(mergedEnvVars).toMatchObject(origEnv);
  });

  test("mergeObjIntoEnv adds object to environment", async () => {
    const mergedEnvVars = mergeObjIntoEnv({ foo: "bar" });
    expect(mergedEnvVars).toMatchObject({ foo: "bar" });
  });
});
