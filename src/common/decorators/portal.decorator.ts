import { SetMetadata } from '@nestjs/common';
import { Portal } from '@prisma/client';

export const PORTAL_KEY = 'portal';

/** Restricts a route (or every route under a controller) to one or more portals. */
export const PortalOnly = (...portals: Portal[]) => SetMetadata(PORTAL_KEY, portals);
