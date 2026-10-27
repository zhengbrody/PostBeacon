import { z } from "zod";

export const bufferChannelSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  service: z.enum(["twitter", "linkedin"]),
  organizationId: z.string().min(1).max(200),
});
export type BufferChannel = z.infer<typeof bufferChannelSchema>;
export const bufferConnectionSchema = z.object({
  id: z.uuid(),
  revision: z.number().int().positive(),
  status: z.enum(["connected", "reauth-required", "disconnected"]),
  accountLabel: z.string().min(1).max(200),
  channels: z.array(bufferChannelSchema).max(100),
});
export type BufferConnection = z.infer<typeof bufferConnectionSchema>;
export interface BufferConnectionList {
  enabled: boolean;
  connection: BufferConnection | null;
  setupIssues: string[];
}
export type BufferConnectionCommand = {
  action: "connect" | "finish" | "refresh-channels" | "disconnect";
};
export interface BufferConnectionResult extends BufferConnectionList {
  authorizationUrl?: string;
}
export const bufferConnectionCommandSchema = z
  .object({
    action: z.enum(["connect", "finish", "refresh-channels", "disconnect"]),
  })
  .strict();
