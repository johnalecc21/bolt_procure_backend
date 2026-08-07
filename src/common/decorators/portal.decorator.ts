import { SetMetadata } from '@nestjs/common';
import { Portal } from '@prisma/client';

export const PORTAL_KEY = 'portal';

/** Restricts a route (or every route under a controller) to a specific portal. */
export const PortalOnly = (portal: Portal) => SetMetadata(PORTAL_KEY, portal);
