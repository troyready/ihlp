/**
 * Tests for Hello world handler
 *
 * @packageDocumentation
 */

import { APIGatewayProxyEvent, Context } from "aws-lambda";

import { handler } from "./handler";

/** Mock callback function for handler invocations */
function unusedCallback<T>() {
  return undefined as any as T; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** Helper for generating input for Lambda from AWS API Gateway */
function generateAPIGatewayProxyEvent({
  httpMethod,
  path,
  body,
  queryStringParameters,
}: {
  httpMethod;
  path;
  body;
  queryStringParameters;
}) {
  return {
    body: body,
    headers: {},
    httpMethod: httpMethod,
    isBase64Encoded: false,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    path: path,
    pathParameters: null,
    queryStringParameters: queryStringParameters,
    requestContext: {
      accountId: "unused",
      apiId: "unused",
      httpMethod: "unused",
      identity: {
        accessKey: "unused",
        accountId: "unused",
        apiKey: "unused",
        apiKeyId: "unused",
        caller: "unused",
        clientCert: null,
        cognitoAuthenticationProvider: "unused",
        cognitoAuthenticationType: "unused",
        cognitoIdentityId: "unused",
        cognitoIdentityPoolId: "unused",
        principalOrgId: "unused",
        sourceIp: "unused",
        user: "unused",
        userAgent: "unused",
        userArn: "unused",
      },
      authorizer: { principalId: "unittestuser" },
      path: "unused",
      protocol: "unused",
      stage: "unused",
      requestId: "unused",
      requestTimeEpoch: 0,
      resourceId: "unused",
      resourcePath: "unused",
    },
    resource: "unused",
    stageVariables: null,
  } as APIGatewayProxyEvent;
}

describe("Handler tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("handler errors on request without body", async () => {
    const handlerReturn = await handler(
      {} as APIGatewayProxyEvent,
      {} as Context,
      unusedCallback<any>(), // eslint-disable-line @typescript-eslint/no-explicit-any
    );
    expect(handlerReturn).toMatchObject({ statusCode: 400 });
  });

  test("handler returns hello world", async () => {
    const handlerReturn = await handler(
      generateAPIGatewayProxyEvent({
        httpMethod: "GET",
        path: "/",
        body: '{"foo": "bar"}',
        queryStringParameters: null,
      }),
      {} as Context,
      unusedCallback<any>(), // eslint-disable-line @typescript-eslint/no-explicit-any
    );
    expect(handlerReturn).toMatchObject({
      body: '{"message":"Hello world"}',
      statusCode: 200,
    });
  });
});
