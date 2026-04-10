import { Prisma } from "../generated/prisma/client.js";

type NullableJsonInput =
  | Prisma.InputJsonValue
  | Prisma.NullableJsonNullValueInput;

export function toNullableJsonInput(value: unknown): NullableJsonInput {
  if (value == null) {
    return Prisma.DbNull;
  }

  return value as Prisma.InputJsonValue;
}
