import {Module} from "@nestjs/common";
import {AuthGuard} from "../../auth/auth.guard.js";
import {PermissionsGuard} from "../../common/permissions/permissions.guard.js";
import {LeadsController} from "./leads.controller.js";
import {LeadsService} from "./leads.service.js";
@Module({controllers:[LeadsController],providers:[LeadsService,AuthGuard,PermissionsGuard]})
export class CrmLeadsModule {}
