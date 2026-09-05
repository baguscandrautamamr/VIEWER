const GUID = /^[0-3][0-9A-Za-z_$]{21}$/;

// Resolve against the original glTF node JSON, before GLTFLoader renames
// primitives or shared meshes. A numeric mesh name is NOT a Revit ElementId.
export function resolveModelIdentity(object, root, parser) {
  for (let current = object; current; current = current.parent) {
    const association = parser.associations.get(current);
    const definition = association?.nodes !== undefined ? parser.json.nodes?.[association.nodes] : null;
    if (current.isInstancedMesh || definition?.extensions?.EXT_mesh_gpu_instancing) return null;
    // Three r170 shares association records between mesh clones. The `.nodes`
    // index may point at the LAST clone. userData.name/extras belong to this
    // actual Object3D and must take precedence over that association.
    const extras = current.userData ?? definition?.extras ?? {};
    const explicit = extras.globalId ?? extras.GlobalId ?? extras.ifcGuid;
    const name = current.userData?.name ?? definition?.name ?? '';
    const id = typeof explicit === 'string' && explicit ? explicit
      : GUID.test(name) || /^\d+$/.test(name) ? name : null;
    if (id) return {
      globalId: id,
      name: typeof extras.elementName === 'string' ? extras.elementName : null,
      category: typeof extras.category === 'string' ? extras.category : null,
    };
    if (current === root) break;
  }
  return null;
}
