import type { Object3D } from 'three';
export interface ModelIdentity { globalId: string; name: string | null; category: string | null }
export function resolveModelIdentity(object: Object3D, root: Object3D, parser: {
  associations: Map<any, any>; json: any;
}): ModelIdentity | null;
