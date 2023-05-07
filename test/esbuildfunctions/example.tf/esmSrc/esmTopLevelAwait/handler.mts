/**
 * Hello world handler testing top-level await
 *
 * @packageDocumentation
 */

import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import {
  APIGatewayProxyEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";

const paramName = process.env.SSM_PARAM_NAME || "";
const ssmClient = new SSMClient({});
const response = (await ssmClient.send(new GetParameterCommand({ Name: paramName}))).Parameter?.Value || "";

/** Respond to incoming requests with hello world message */
export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent,
  context: Context, // eslint-disable-line @typescript-eslint/no-unused-vars
): Promise<APIGatewayProxyResult> => {
  let body: any = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (event.body) {
    body = JSON.parse(event.body);
  } else {
    console.log("Body not found on event");
    return {
      body: JSON.stringify({
        errorType: "BadRequest",
        message: "Missing body in request",
      }),
      statusCode: 400,
    };
  }

  return {
    body: JSON.stringify({ message: response }),
    statusCode: 200,
  };
};
