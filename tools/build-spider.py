"""Build the user-provided Blender spider, retaining its mesh/UVs/textures.
Run Blender --background --factory-startup --disable-autoexec Spider_lp.blend
  --python tools/build-spider.py -- <texture-directory> <output.glb>
No embedded source scripts are executed. All rigging and clips below are original.
"""
import bpy, math, json, os, sys
from mathutils import Vector, Matrix, Quaternion

arguments=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
TEXTURES=arguments[0] if arguments else os.path.join(os.path.dirname(__file__),'textures')
OUTPUT=arguments[1] if len(arguments)>1 else os.path.join(os.path.dirname(__file__),'spider.glb')
os.makedirs(os.path.dirname(os.path.abspath(OUTPUT)),exist_ok=True)
FPS=50
HEIGHT=.68
obj=bpy.data.objects['Spider']
bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
# Preserve the authored viewport subdivision, including its UV interpolation.
for modifier in list(obj.modifiers):
    if modifier.type=='SUBSURF':bpy.ops.object.modifier_apply(modifier=modifier.name)
coordinates=[v.co.copy() for v in obj.data.vertices]
bottom=min(v.z for v in coordinates);top=max(v.z for v in coordinates)
scale=HEIGHT/(top-bottom)
def point(v):return Vector((v[0]*scale,v[1]*scale,(v[2]-bottom)*scale))
for vertex,original in zip(obj.data.vertices,coordinates):vertex.co=point(original)
obj.name='SpiderMesh';obj.data.name='SuppliedSpiderGeometry'
for face in obj.data.polygons:face.use_smooth=True

material=bpy.data.materials.new('Spider_Authored_PBR');material.use_nodes=True
nodes=material.node_tree.nodes;nodes.clear();links=material.node_tree.links
output=nodes.new('ShaderNodeOutputMaterial');shader=nodes.new('ShaderNodeBsdfPrincipled');links.new(shader.outputs['BSDF'],output.inputs['Surface'])
shader.inputs['Metallic'].default_value=0
for filename,target,color_space in [('Spider_dif1.png','Base Color','sRGB'),('Spider_rou1.png','Roughness','Non-Color'),('Spider_glossy1.png','Specular','Non-Color'),('Spider_nor1.png','Normal','Non-Color')]:
    texture=nodes.new('ShaderNodeTexImage');texture.image=bpy.data.images.load(os.path.join(TEXTURES,filename),check_existing=False);texture.image.colorspace_settings.name=color_space
    if target=='Normal':
        normal=nodes.new('ShaderNodeNormalMap');links.new(texture.outputs['Color'],normal.inputs['Color']);links.new(normal.outputs['Normal'],shader.inputs['Normal'])
    else:links.new(texture.outputs['Color'],shader.inputs[target])
obj.data.materials.clear();obj.data.materials.append(material)

armature=bpy.data.armatures.new('Spider_Original_Rig')
rig=bpy.data.objects.new('SpiderRig',armature);bpy.context.collection.objects.link(rig)
rig['sourceArchive']='User-provided spider.zip/source/Spider.rar/Spider_lp.blend'
rig['modifications']='Original smooth 8-leg rig and idle/walk/capture/feeding/release/attack/stun clips; authored mesh, UVs and PBR maps retained; viewport subdivision applied; Y-up +Z-forward normalized export.'
rig['walkMetersPerSecond']=.5;rig['walkDuration']=.8;rig['footStride']=.2;rig['attackImpactTime']=.28;rig['sourceHeight']=HEIGHT
bpy.context.view_layer.objects.active=rig;obj.select_set(False);rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
definitions={}
def add_bone(name,head,tail,parent=None,deform=True):
    bone=armature.edit_bones.new(name);bone.head=point(head);bone.tail=point(tail);bone.use_deform=deform
    if parent:bone.parent=armature.edit_bones[parent]
    definitions[name]=(Vector(head),Vector(tail));return bone
add_bone('SpiderRoot',(0,0,bottom),(0,0,bottom+.3),None,False)
add_bone('SpiderBody',(0,.2,.35),(0,-.35,.35),'SpiderRoot')
add_bone('SpiderHead',(0,-.50,.45),(0,-1.1,.43),'SpiderBody')
add_bone('SpiderAbdomen',(0,1.1,.70),(0,2.4,1.0),'SpiderBody')
add_bone('SpiderFace',(0,-1.17,.43),(0,-1.40,.43),'SpiderHead',False)
legs=[];mandibles=[]
hips=[(.69,-.58,.36),(.84,-.12,.34),(.85,.58,.40),(.70,.98,.47)]
knees=[(1.48,-1.95,.80),(2.12,-.83,1.08),(2.73,1.27,1.30),(1.55,2.57,1.28)]
tips=[(2.04,-3.34,-.49),(2.82,-1.49,-.51),(3.80,2.18,-.51),(2.02,4.32,-.50)]
for side,sign in [('L',1),('R',-1)]:
    for index,(h,k,t) in enumerate(zip(hips,knees,tips),1):
        h=Vector((h[0]*sign,h[1],h[2]));k=Vector((k[0]*sign,k[1],k[2]));guess=Vector((t[0]*sign,t[1],t[2]))
        candidates=[v for v in coordinates if (Vector((v.x,v.y,0))-Vector((guess.x,guess.y,0))).length<.32]
        t=min(candidates,key=lambda v:v.z).copy();a=k.lerp(t,.72)
        names=[f'SpiderLeg{side}{index}{segment}'for segment in ['Upper','Mid','Foot']]
        add_bone(names[0],h,k,'SpiderBody');add_bone(names[1],k,a,names[0]);add_bone(names[2],a,t,names[1])
        legs.append({'names':names,'points':[h,k,a,t],'side':side,'index':index,'phase':((index+(1 if side=='R' else 0))%2)*math.pi})
    h=Vector((sign*.40,-.82,.28));k=Vector((sign*.61,-1.90,.54));t=Vector((sign*.59,-2.96,-.18))
    names=[f'SpiderMandible{side}',f'SpiderMandible{side}Tip'];add_bone(names[0],h,k,'SpiderHead');add_bone(names[1],k,t,names[0]);mandibles.append({'names':names,'points':[h,k,t]})
bpy.ops.object.mode_set(mode='OBJECT')
modifier=obj.modifiers.new('Original smooth spider skin','ARMATURE');modifier.object=rig;obj.parent=rig
groups={name:obj.vertex_groups.new(name=name)for name,bone in armature.bones.items()if bone.use_deform}
def smooth(a,b,x):
    t=max(0,min(1,(x-a)/(b-a)));return t*t*(3-2*t)
def segment(v,a,b):
    direction=b-a;t=max(0,min(1,(v-a).dot(direction)/direction.length_squared));return(v-(a+t*direction)).length,t
def chain(v,points):
    lengths=[(b-a).length for a,b in zip(points,points[1:])];results=[];offset=0
    for a,b,length in zip(points,points[1:],lengths):
        distance,t=segment(v,a,b);results.append((distance,offset+t*length));offset+=length
    distance,along=min(results);return distance,along,lengths
def body_weights(v):
    if v.y>1.0:
        t=smooth(.9,1.55,v.y);return{'SpiderBody':1-t,'SpiderAbdomen':t}
    t=1-smooth(-.95,-.35,v.y);return{'SpiderBody':1-t,'SpiderHead':t}
foot_counts={leg['names'][2]:0 for leg in legs}
weight_error=0
for vertex,v in zip(obj.data.vertices,coordinates):
    body=body_weights(v)
    body_score=min(segment(v,Vector((0,-.80,.4)),Vector((0,.80,.4)))[0]/.63,segment(v,Vector((0,1.2,.85)),Vector((0,2.7,1.0)))[0]/.88)
    candidates=[]
    for limb in legs+mandibles:
        distance,along,lengths=chain(v,limb['points']);radius=.19 if limb in legs else .15
        candidates.append((distance/radius,along,lengths,limb))
    score,along,lengths,limb=min(candidates,key=lambda entry:entry[0])
    limb_mix=1-smooth(.68,1.32,score/max(body_score,.01))
    limb_mix*=smooth(.05,.39,along)
    names=limb['names'];limb_weights={names[0]:1.0};offset=0
    for i,length in enumerate(lengths[:-1]):
        offset+=length
        if along>offset+.16:limb_weights={names[i+1]:1.0}
        elif along>offset-.16:
            t=smooth(offset-.16,offset+.16,along);limb_weights={names[i]:1-t,names[i+1]:t};break
        else:break
    weights={name:weight*(1-limb_mix)for name,weight in body.items()}
    for name,weight in limb_weights.items():weights[name]=weights.get(name,0)+weight*limb_mix
    weights=sorted(((name,weight)for name,weight in weights.items()if weight>1e-8),key=lambda x:-x[1])[:4];total=sum(weight for _,weight in weights)
    for name,weight in weights:
        weight/=total;groups[name].add([vertex.index],weight,'REPLACE')
        if name in foot_counts and weight>=.25:foot_counts[name]+=1
    weight_error=max(weight_error,abs(sum(weight/total for _,weight in weights)-1))

bpy.context.scene.render.fps=FPS
rig.animation_data_create()
def reset():
    for bone in rig.pose.bones:bone.matrix_basis=Matrix.Identity(4);bone.rotation_mode='QUATERNION'
    bpy.context.view_layer.update()
def rotate_world(name,axis,angle):
    bone=rig.pose.bones[name];rest=bone.bone.matrix_local.to_quaternion();bone.rotation_quaternion=rest.inverted()@Quaternion(axis,angle)@rest
def set_segment(name,head,tail):
    bone=rig.pose.bones[name];rest=bone.bone
    rotation=(rest.tail_local-rest.head_local).rotation_difference(tail-head)@rest.matrix_local.to_quaternion()
    bone.matrix=Matrix.LocRotScale(head,rotation,Vector((1,1,1)));bpy.context.view_layer.update()
clamped=0
def solve_leg(leg,delta):
    global clamped
    h,k,a,t=[point(p)for p in leg['points']];target_a=a+delta;target_t=t+delta
    upper=(k-h).length;lower=(a-k).length;direction=target_a-h;distance=direction.length
    if distance>upper+lower-.0001:clamped+=1;direction.normalize();target_a=h+direction*(upper+lower-.0001);target_t=target_a+(t-a);distance=upper+lower-.0001
    direction=(target_a-h).normalized();along=(upper*upper-lower*lower+distance*distance)/(2*distance)
    bend=k-h;pole=(bend-direction*bend.dot(direction)).normalized();perpendicular=math.sqrt(max(0,upper*upper-along*along));joint=h+direction*along+pole*perpendicular
    set_segment(leg['names'][0],h,joint);set_segment(leg['names'][1],joint,target_a);set_segment(leg['names'][2],target_a,target_t)
def pose(kind,time,duration):
    reset()
    if kind=='idle':
        rig.pose.bones['SpiderAbdomen'].scale=Vector((1,1,1+math.sin(time/duration*math.tau)*.012))
        rotate_world('SpiderHead',(0,0,1),math.sin(time/duration*math.tau)*.012)
    for leg in legs:
        delta=Vector((0,0,0))
        if kind=='walk':
            phase=time/.8*math.tau+leg['phase'];delta.y=-.10*math.sin(phase);delta.z=.055*max(0,math.cos(phase))
        elif kind in ('capture','release','feeding') and leg['index']<=2:
            amount=1 if kind=='feeding' else smooth(0,.52,time) if kind=='capture' else 1-smooth(0,duration,time)
            delta.y=-.05*amount;delta.z=(.18 if leg['index']==1 else .11)*amount
        elif kind=='attack' and leg['index']<=2:
            strike=smooth(.12,.28,time)*(1-.5*smooth(.32,.8,time));strike*=1-.30*smooth(1.2,duration,time)
            delta.y=-.11*strike;delta.z=(.27 if leg['index']==1 else .14)*strike
        elif kind=='stun':
            amount=math.sin(math.pi*min(1,time/duration));delta.x=(1 if leg['side']=='L' else -1)*.035*amount;delta.z=.012*math.sin(time*40+leg['phase'])*amount
        solve_leg(leg,delta)
    for limb in mandibles:
        side=1 if limb['names'][0].endswith('L') else -1
        amount=.035*math.sin(time/duration*math.tau) if kind=='idle' else 0
        if kind=='capture':amount=.30*smooth(0,.50,time)
        if kind=='feeding':amount=.30+.055*math.sin(time/duration*math.tau*3)
        if kind=='release':amount=.30*(1-smooth(0,duration,time))
        if kind=='attack':amount=.6*smooth(0,.18,time)-.9*smooth(.18,.28,time)+.15*smooth(.4,1.2,time)
        if kind=='stun':amount=.15*math.sin(time*35)*(1-time/duration)
        rotate_world(limb['names'][0],(0,0,1),side*amount);rotate_world(limb['names'][1],(1,0,0),abs(amount)*.45)
    if kind=='attack':rotate_world('SpiderHead',(1,0,0),-.22*smooth(.12,.28,time)+.11*smooth(.4,1.1,time))
    bpy.context.view_layer.update()

actions=[]
for name,duration in [('idle',2.4),('walk',.8),('capture',.8),('feeding',2.0),('release',.5),('attack',1.6),('stun',1.2)]:
    action=bpy.data.actions.new(name);rig.animation_data.action=action;frames=round(duration*FPS)
    for frame in range(frames+1):
        pose(name,frame/FPS,duration)
        for bone in rig.pose.bones:
            bone.keyframe_insert('rotation_quaternion',frame=frame,group=bone.name)
            bone.keyframe_insert('location',frame=frame,group=bone.name)
            bone.keyframe_insert('scale',frame=frame,group=bone.name)
    for curve in action.fcurves:
        for key in curve.keyframe_points:key.interpolation='LINEAR'
    action.use_fake_user=True;actions.append({'name':name,'duration':duration,'frames':frames+1})
rig.animation_data.action=None;reset();bpy.context.scene.frame_set(0)
# Numerical audit before export: the authored surface must not change in bind pose.
bpy.context.view_layer.update();evaluated=obj.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=evaluated.to_mesh()
bind_error=max((v.co-mesh.vertices[v.index].co).length for v in obj.data.vertices);evaluated.to_mesh_clear()
obj.data.calc_loop_triangles()
report={'vertices':len(obj.data.vertices),'triangles':len(obj.data.loop_triangles),'bones':[{'name':b.name,'parent':b.parent.name if b.parent else None,'headYUp':[b.head_local.x,b.head_local.z,-b.head_local.y],'tailYUp':[b.tail_local.x,b.tail_local.z,-b.tail_local.y]}for b in armature.bones], 'actions':actions,'height':HEIGHT,'scale':scale,'sourceBottom':bottom,'footWeightedVertices':foot_counts,'maxWeightError':weight_error,'bindPoseError':bind_error,'ikClampSamples':clamped}
with open(os.path.splitext(OUTPUT)[0]+'-build-report.json','w')as f:json.dump(report,f,indent=2)
if bind_error>1e-5 or not all(foot_counts.values()):raise RuntimeError('Spider skin audit failed')
bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);rig.select_set(True);bpy.context.view_layer.objects.active=rig
bpy.ops.export_scene.gltf(filepath=OUTPUT,export_format='GLB',use_selection=True,export_apply=False,export_yup=True,export_animations=True,export_animation_mode='ACTIONS',export_anim_single_armature=True,export_force_sampling=True,export_frame_range=False,export_extras=True,export_skins=True,export_def_bones=False)
print('SPIDER_BUILD '+json.dumps({k:v for k,v in report.items()if k!='bones'},separators=(',',':')))
