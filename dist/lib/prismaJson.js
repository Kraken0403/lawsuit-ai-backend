import { Prisma } from "../generated/prisma/client.js";
export function toNullableJsonInput(value) {
    if (value == null) {
        return Prisma.DbNull;
    }
    return value;
}
//# sourceMappingURL=prismaJson.js.map