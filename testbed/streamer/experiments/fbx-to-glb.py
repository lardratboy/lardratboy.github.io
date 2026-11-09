# An FBX to a GLB, through Blender run headless: mesh-vdag.mjs reads glTF only.
# Written for the Halloween pack (docs/colororgeneralfields.md §3), an FBX that
# ships its gradient atlas beside it with the material left unwired.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
#     --python experiments/fbx-to-glb.py -- in.fbx out.glb [atlas.png]
#
# Each mesh's first UV map becomes TEXCOORD_0 (the pack's atlas UVs come first;
# its later maps are backups). With an atlas, every material whose Base Color
# has nothing linked gets the atlas. Images are embedded in the GLB.
import bpy, sys
args = sys.argv[sys.argv.index('--') + 1:]
src, dst = args[:2]
atlas = args[2] if len(args) > 2 else None
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
for o in meshes:
    uv = o.data.uv_layers
    if len(uv):
        uv.active = uv[0]
        for i, layer in enumerate(uv): layer.active_render = (i == 0)
if atlas:
    img = bpy.data.images.load(atlas)
    for m in bpy.data.materials:
        if not m.use_nodes: m.use_nodes = True
        nt = m.node_tree
        bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if bsdf is None or bsdf.inputs['Base Color'].is_linked: continue
        tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img
        nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        print('WIRED', m.name)
print('IMPORTED', len(meshes), 'meshes,', sum(len(o.data.polygons) for o in meshes), 'polygons')
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_image_format='AUTO', export_apply=True, export_animations=False)
print('EXPORTED', dst)
