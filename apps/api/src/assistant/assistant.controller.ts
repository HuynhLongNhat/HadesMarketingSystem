import {
  Body,
  CanActivate,
  Controller,
  Delete,
  ExecutionContext,
  ForbiddenException,
  Get,
  Injectable,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { once } from "node:events";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentContext } from "../auth/current-context.decorator.js";
import type { RequestContext } from "../auth/request-context.js";
import { PermissionsGuard } from "../common/permissions/permissions.guard.js";
import { RequirePermissions } from "../common/permissions/permissions.decorator.js";
import { PERMISSIONS } from "../common/permissions/permissions.js";
import {
  AssistantMessageDto,
  RenameAssistantConversationDto,
} from "./assistant.dto.js";
import { AssistantService, publicTurn } from "./assistant.service.js";

@Injectable()
export class AssistantOriginGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return true;
    const origins = (
      process.env.WEB_URL ?? "http://localhost:3000,http://localhost:3001"
    )
      .split(",")
      .map((v) => v.trim());
    if (!req.headers.origin || !origins.includes(req.headers.origin))
      throw new ForbiddenException(
        "Nguồn yêu cầu không hợp lệ. Hãy sử dụng giao diện Nova.",
      );
    return true;
  }
}

@Controller("assistant")
@UseGuards(AuthGuard, PermissionsGuard, AssistantOriginGuard)
@RequirePermissions(PERMISSIONS.ASSISTANT_USE)
export class AssistantController {
  constructor(private readonly service: AssistantService) {}
  @Get("options") options(@CurrentContext() ctx: RequestContext) {
    return this.service.options(ctx);
  }
  @Get("conversations") list(@CurrentContext() ctx: RequestContext) {
    return this.service.list(ctx);
  }
  @Post("conversations") create(@CurrentContext() ctx: RequestContext) {
    return this.service.create(ctx);
  }
  @Get("conversations/:id") get(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
  ) {
    return this.service.get(ctx, id);
  }
  @Patch("conversations/:id") rename(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
    @Body() dto: RenameAssistantConversationDto,
  ) {
    return this.service.rename(ctx, id, dto.title);
  }
  @Delete("conversations/:id") remove(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
  ) {
    return this.service.remove(ctx, id);
  }
  @Post("conversations/:id/messages/:requestId/cancel") cancel(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
    @Param("requestId") requestId: string,
  ) {
    return this.service.cancel(ctx, id, requestId);
  }
  @Post("conversations/:id/messages")
  async message(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
    @Body() dto: AssistantMessageDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const claim = await this.service.claim(ctx, id, dto);
    res
      .status(200)
      .set({
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        Connection: "keep-alive",
      });
    res.flushHeaders();
    const abort = new AbortController();
    const onClose = () => {
      if (!res.writableEnded) abort.abort();
    };
    res.on("close", onClose);
    req.on("aborted", onClose);
    const keepAlive = setInterval(() => {
      if (!res.destroyed && !res.writableEnded) res.write(": keep-alive\n\n");
    }, 15_000);
    keepAlive.unref();
    const send = async (event: unknown) => {
      if (res.destroyed || abort.signal.aborted)
        throw new Error("Client disconnected");
      if (!res.write(`data: ${JSON.stringify(event)}\n\n`))
        await once(res, "drain", { signal: abort.signal });
    };
    try {
      if (claim.replay)
        await send({ type: "done", turn: publicTurn(claim.turn) });
      else await this.service.generate(ctx, claim.turn, abort.signal, send);
    } catch {
      if (!res.destroyed)
        await send({
          type: "error",
          message:
            "Không thể lưu phản hồi. Hãy làm mới để kiểm tra trạng thái trước khi thử lại.",
        }).catch(() => undefined);
    } finally {
      clearInterval(keepAlive);
      res.off("close", onClose);
      req.off("aborted", onClose);
      if (!res.destroyed) res.end();
    }
  }
}
