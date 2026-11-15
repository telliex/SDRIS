import type { Marker as I } from '@sdris/investigation';
import type { Marker as E } from '@sdris/evidence';
import type { Marker as D } from '@sdris/diagnostics';
import type { Marker as K } from '@sdris/shared-kernel';
import type { Marker as C } from '@sdris/contracts';
import type { Marker as G } from '@sdris/config';
export type Root = [I, E, D, K, C, G];
export const lazy = () => import('@sdris/workflow');
