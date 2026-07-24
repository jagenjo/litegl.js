/**
* @namespace GL
*/

import type { Mesh } from "./mesh";
import { HitTest } from "./raytracer";

import { geo } from "./geo";

/** Axis aligned bounding box returned by the computeAABB* helpers. */
interface AABB {
  min: Float32Array;
  max: Float32Array;
}

/**
* A single node of the octree. In the original code these are created via `new OctreeNode(min,max)`
* and later decorated with `faces`, `inside` and children (`c`). Kept as an internal class so the
* constructor (which computes `size`) behaves exactly as before while providing a strict node type.
*/
class OctreeNode {
	min: Float32Array;
	max: Float32Array;
	size: Float32Array;
	faces: Float32Array[] | null = null; //[ Float32Array[10], ... ]
	inside = 0;
	c: OctreeNode[] | null = null; //children

	constructor( min: Float32Array, max: Float32Array )
	{
		this.min = min;
		this.max = max;
		this.size = vec3.sub( vec3.create(), max, min );
	}
}

//module-private diagnostic counters (not part of the public API)
let octree_tested_boxes = 0;
let octree_tested_triangles = 0;

//reusable scratch vectors (one allocation set per function, as in the original IIFE closures)
const _vf_V1 = vec3.create();
const _vf_V2 = vec3.create();
const _vf_N = vec3.create();

const _tr_origin = vec3.create();
const _tr_direction = vec3.create();
const _tr_min = vec3.create();
const _tr_max = vec3.create();

const _cp_plane = new Float32Array(4);
const _cp_point = vec3.create();
const _cp_c1 = vec3.create();
const _cp_c2 = vec3.create();
const _cp_c3 = vec3.create();

const _hb_tMin = vec3.create();
const _hb_tMax = vec3.create();
const _hb_inv = vec3.create();
const _hb_t1 = vec3.create();
const _hb_t2 = vec3.create();
const _hb_tmp = vec3.create();
const _hb_epsilon = 1.0e-6;
const _hb_eps = vec3.fromValues( _hb_epsilon, _hb_epsilon, _hb_epsilon );

const _ht_AB = vec3.create();
const _ht_AC = vec3.create();
const _ht_toHit = vec3.create();
const _ht_tmp = vec3.create();

const _st_A = vec3.create();
const _st_B = vec3.create();
const _st_C = vec3.create();
const _st_AB = vec3.create();
const _st_AC = vec3.create();
const _st_BC = vec3.create();
const _st_CA = vec3.create();
const _st_V = vec3.create();

/**
*   Octree generator for fast ray triangle collision with meshes
*	Dependencies: glmatrix.js (for vector and matrix operations)
* @class Octree
* @constructor
* @param {Mesh} mesh object containing vertices buffer (indices buffer optional)
*/
export class Octree {
	static MAX_NODE_TRIANGLES_RATIO = 0.05;
	static MAX_OCTREE_DEPTH = 8;
	static OCTREE_MARGIN_RATIO = 0.01;
	static OCTREE_MIN_MARGIN = 0.1;

	//mode
	static NEAREST = 0; //returns the nearest collision
	static FIRST = 1; //returns the first collision
	static ALL = 2;  //returns the all collisions

	root: OctreeNode | null;
	total_depth: number;
	total_nodes: number;
	total_triangles = 0;
	max_node_triangles = 0;

	octree_pos_ref: number[][] = [[0,0,0],[0,0,1],[0,1,0],[0,1,1],[1,0,0],[1,0,1],[1,1,0],[1,1,1]];

	constructor( mesh?: Mesh, start?: number, length?: number )
	{
		this.root = null;
		this.total_depth = 0;
		this.total_nodes = 0;
		if(mesh)
			this.buildFromMesh(mesh, start, length);
	}

	buildFromMesh( mesh: Mesh, start?: number, length?: number ): OctreeNode
	{
		this.total_depth = 0;
		this.total_nodes = 0;
		start = start || 0;

		const vertices = mesh.getBuffer("vertices").data as Float32Array;
		const triangles_buffer = mesh.getIndexBuffer("triangles");
		const triangles = triangles_buffer ? triangles_buffer.data : null; //get the internal data

		if( !length )
			length = triangles ? triangles.length : vertices.length / 3;

		let bounding: AABB;
		if( triangles )
			bounding = this.computeAABBFromIndices(vertices,triangles,start,length);
		else
			bounding = this.computeAABB(vertices);

		const root = new OctreeNode(bounding.min, bounding.max);
		this.root = root;
		this.total_nodes = 1;
		this.total_triangles = triangles ? triangles.length / 3 : vertices.length / 9;
		this.max_node_triangles = this.total_triangles * Octree.MAX_NODE_TRIANGLES_RATIO;

		const margin = vec3.create();
		vec3.scale( margin, root.size, Octree.OCTREE_MARGIN_RATIO );
		if(margin[0] < Octree.OCTREE_MIN_MARGIN) margin[0] = Octree.OCTREE_MIN_MARGIN;
		if(margin[1] < Octree.OCTREE_MIN_MARGIN) margin[1] = Octree.OCTREE_MIN_MARGIN;
		if(margin[2] < Octree.OCTREE_MIN_MARGIN) margin[2] = Octree.OCTREE_MIN_MARGIN;

		vec3.sub(root.min, root.min, margin);
		vec3.add(root.max, root.max, margin);

		root.faces = [];

		//indexed
		const end = start + length;
		if(triangles)
		{
			for(let i = start; i < end; i+=3)
			{
				//10th position contains the face index
				const face = new Float32Array([vertices[triangles[i]*3], vertices[triangles[i]*3+1],vertices[triangles[i]*3+2],
							vertices[triangles[i+1]*3], vertices[triangles[i+1]*3+1],vertices[triangles[i+1]*3+2],
							vertices[triangles[i+2]*3], vertices[triangles[i+2]*3+1],vertices[triangles[i+2]*3+2],i/3]);
				if(Octree.isValidFace(face))
					this.addToNode( face,root,0);
			}
		}
		else
		{
			for(let i = start*3; i < length*3; i+=9) //vertices
			{
				const face = new Float32Array( 10 );
				face.set( vertices.subarray(i,i+9) );
				face[9] = i/9;
				if(Octree.isValidFace(face))
					this.addToNode(face,root,0);
			}
		}

		this.total_nodes = this.trim();

		return root;
	}

	static isValidFace( face: Float32Array ): boolean
	{
		const A = face.subarray(0,3);
		const B = face.subarray(3,6);
		const C = face.subarray(6,9);
		vec3.sub(_vf_V1,B,A);
		vec3.sub(_vf_V2,C,A);
		vec3.cross( _vf_N, _vf_V1,_vf_V2);
		return vec3.length(_vf_N) > 0;
	}

	addToNode( face: Float32Array, node: OctreeNode, depth: number ): void
	{
		node.inside += 1;

		//has children
		if(node.c)
		{
			const aabb = this.computeAABB(face);
			let added = false;
			for(let i = 0; i < node.c.length; ++i)
			{
				const child = node.c[i];
				if (Octree.isInsideAABB(aabb,child))
				{
					this.addToNode(face,child, depth+1);
					added = true;
					break;
				}
			}
			if(!added)
			{
				if(node.faces == null)
					node.faces = [];
				node.faces.push(face);
			}
		}
		else //add till full, then split
		{
			if(node.faces == null)
				node.faces = [];
			node.faces.push(face);

			//split
			if(node.faces.length > this.max_node_triangles && depth < Octree.MAX_OCTREE_DEPTH)
			{
				//create empty children nodes
				this.splitNode(node);
				if(this.total_depth < depth + 1)
					this.total_depth = depth + 1;

				const faces = node.faces;
				node.faces = null;
				const children = node.c as unknown as OctreeNode[]; //splitNode() just populated node.c

				//redistribute all faces
				for(let i = 0; i < faces.length; ++i)
				{
					const face2 = faces[i];
					const aabb = this.computeAABB(face2);
					let added = false;
					for(let j = 0; j < children.length; ++j)
					{
						const child = children[j];
						if (Octree.isInsideAABB(aabb,child))
						{
							this.addToNode(face2,child, depth+1);
							added = true;
							break;
						}
					}
					if (!added)
					{
						if(node.faces == null)
							node.faces = [];
						node.faces.push(face2);
					}
				}
			}
		}
	}

	splitNode( node: OctreeNode ): void
	{
		node.c = [];
		const half = [(node.max[0] - node.min[0]) * 0.5, (node.max[1] - node.min[1]) * 0.5, (node.max[2] - node.min[2]) * 0.5];

		for(let i = 0; i < this.octree_pos_ref.length; ++i)
		{
			const ref = this.octree_pos_ref[i];

			const min = new Float32Array([ node.min[0] + half[0] * ref[0],  node.min[1] + half[1] * ref[1],  node.min[2] + half[2] * ref[2]]);
			const max = new Float32Array([ min[0] + half[0], min[1] + half[1], min[2] + half[2]]);

			const newnode = new OctreeNode(min,max);
			this.total_nodes += 1;

			newnode.faces = null;
			newnode.inside = 0;
			node.c.push(newnode);
		}
	}

	//receives typed array with three vertices of a triangle (plus the index)
	computeAABB( vertices: Float32Array ): AABB
	{
		const min = new Float32Array([ vertices[0], vertices[1], vertices[2] ]);
		const max = new Float32Array(min);

		//last one is the index, skip it
		for(let i = 3; i < vertices.length - 1; i+=3)
		{
			for(let j = 0; j < 3; j++)
			{
				if(min[j] > vertices[i+j])
					min[j] = vertices[i+j];
				if(max[j] < vertices[i+j])
					max[j] = vertices[i+j];
			}
		}

		return {min,max};
	}

	computeAABBFromIndices( vertices: Float32Array, indices: ArrayLike<number>, start?: number, length?: number ): AABB
	{
		start = start || 0;
		length = length || indices.length;

		const first = indices[start];
		const min = new Float32Array([ vertices[first*3], vertices[first*3+1], vertices[first*3+2] ]);
		const max = new Float32Array([ vertices[first*3], vertices[first*3+1], vertices[first*3+2] ]);

		for(let i = start+1; i < start+length; ++i)
		{
			const index = indices[i]*3;
			for(let j = 0; j < 3; j++)
			{
				if(min[j] > vertices[index+j])
					min[j] = vertices[index+j];
				if(max[j] < vertices[index+j])
					max[j] = vertices[index+j];
			}
		}

		return { min,max }
	}

	//remove empty nodes
	trim( node?: OctreeNode ): number
	{
		node = node || this.root || undefined;
		if(!node)
			return 0;
		if(!node.c)
			return 1;

		let num = 1;
		const valid: OctreeNode[] = [];
		const c = node.c;
		for(let i = 0; i < c.length; ++i)
		{
			if(c[i].inside)
			{
				valid.push(c[i]);
				num += this.trim(c[i]);
			}
		}
		node.c = valid;
		return num;
	}

	/**
	* Test collision between ray and triangles in the octree
	* @method testRay
	* @param {vec3} origin ray origin position
	* @param {vec3} direction ray direction position
	* @param {number} dist_min
	* @param {number} dist_max
	* @param {number} test_backfaces if rays colliding with the back face must be considered a valid collision
	* @param {number} mode which mode to use (Octree.NEAREST: nearest collision to origin, Octree.FIRST: first collision detected (fastest), Octree.ALL: all collision (slowest)
	* @return {HitTest} object containing pos, normal, index
	*/
	testRay( origin: NumberArray, direction: NumberArray, dist_min?: number, dist_max?: number, test_backfaces?: boolean, mode?: number ): HitTest | HitTest[] | null
	{
		octree_tested_boxes = 0;
		octree_tested_triangles = 0;
		mode = mode || Octree.NEAREST;

		if(!this.root)
		{
			throw("Error: octree not build");
		}

		_tr_origin.set( origin );
		_tr_direction.set( direction );
		_tr_min.set( this.root.min );
		_tr_max.set( this.root.max );

		const box_test = Octree.hitTestBox( _tr_origin, _tr_direction, _tr_min, _tr_max );
		if(!box_test) //no collision with mesh bounding box
			return null;

		const test = Octree.testRayInNode( this.root, _tr_origin, _tr_direction, test_backfaces, mode );
		if(test == null )
			return null;

		if(mode == Octree.ALL)
			return test;

		const hit_test = test as HitTest;
		const pos = vec3.scale( vec3.create(), direction, hit_test.t );
		vec3.add( pos, pos, origin );
		hit_test.pos = pos;
		return hit_test;
	}

	//tests collisions with a node of the octree and its children
	//WARNING: cannot use static here, it uses recursion
	static testRayInNode( node: OctreeNode, origin: Float32Array, direction: Float32Array, test_backfaces?: boolean, mode?: number ): HitTest | HitTest[] | null
	{
		let prev_test: HitTest | HitTest[] | null = null;
		octree_tested_boxes += 1;

		//test faces
		if(node.faces)
			for(let i = 0, l = node.faces.length; i < l; ++i)
			{
				const face = node.faces[i];
				octree_tested_triangles += 1;
				const test = Octree.hitTestTriangle( origin, direction, face.subarray(0,3) , face.subarray(3,6), face.subarray(6,9), test_backfaces );
				if (test == null)
					continue;
				test.index = face[9]
				if(mode == Octree.FIRST)
					return test;
				if(mode == Octree.ALL)
				{
					if(!prev_test)
						prev_test = [];
					(prev_test as HitTest[]).push(test);
				}
				else { //find closer
					test.face = face;
					if(prev_test)
						(prev_test as HitTest).mergeWith( test );
					else
						prev_test = test;
				}
			}

		//WARNING: cannot use statics here, this function uses recursion
		const child_min = vec3.create();
		const child_max = vec3.create();

		//test children nodes faces
		if(node.c)
			for(let i = 0; i < node.c.length; ++i)
			{
				const child = node.c[i];
				child_min.set( child.min );
				child_max.set( child.max );

				//test with node box
				const box_test = Octree.hitTestBox( origin, direction, child_min, child_max );
				if( box_test == null )
					continue;

				//nodebox behind current collision, then ignore node
				if(mode != Octree.ALL && prev_test && box_test.t > (prev_test as HitTest).t)
					continue;

				//test collision with node
				const test = Octree.testRayInNode( child, origin, direction, test_backfaces, mode );
				if(test == null)
					continue;
				if(mode == Octree.FIRST)
					return test;

				if(mode == Octree.ALL)
				{
					if(!prev_test)
						prev_test = [];
					(prev_test as HitTest[]).push(test as HitTest);
				}
				else {
					if(prev_test)
						(prev_test as HitTest).mergeWith( test as HitTest );
					else
						prev_test = test;
				}
			}

		return prev_test;
	}

	/**
	* test collision between sphere and the triangles in the octree (only test if there is any vertex inside the sphere)
	* @method testSphere
	* @param {vec3} origin sphere center
	* @param {number} radius
	* @return {Boolean} true if the sphere collided with the mesh
	*/
	testSphere( origin: NumberArray, radius: number ): boolean
	{
		const center = vec3.clone(origin);
		octree_tested_boxes = 0;
		octree_tested_triangles = 0;

		if(!this.root)
			throw("Error: octree not build");

		//better to use always the radius squared, because all the calculations are going to do that
		const rr = radius * radius;

		if( !Octree.testSphereBox( center, rr, vec3.clone(this.root.min), vec3.clone(this.root.max) ) )
			return false; //out of the box

		return Octree.testSphereInNode( this.root, center, rr );
	}

	//WARNING: cannot use static here, it uses recursion
	static testSphereInNode( node: OctreeNode, origin: Float32Array, radius2: number ): boolean
	{
		octree_tested_boxes += 1;

		//test faces
		if(node.faces)
			for(let i = 0, l = node.faces.length; i < l; ++i)
			{
				const face = node.faces[i];
				octree_tested_triangles += 1;
				if( Octree.testSphereTriangle( origin, radius2, face.subarray(0,3) , face.subarray(3,6), face.subarray(6,9) ) )
					return true;
			}

		//WARNING: cannot use statics here, this function uses recursion
		const child_min = vec3.create();
		const child_max = vec3.create();

		//test children nodes faces
		if(node.c)
			for(let i = 0; i < node.c.length; ++i)
			{
				const child = node.c[i];
				child_min.set( child.min );
				child_max.set( child.max );

				//test with node box
				if( !Octree.testSphereBox( origin, radius2, child_min, child_max ) )
					continue;

				//test collision with node content
				if( Octree.testSphereInNode( child, origin, radius2 ) )
					return true;
			}

		return false;
	}

	//
	//

	/**
	* finds which is the nearest point to a mesh, and also the normal of that point, and returns the distance
	* @method findNearestPoint
	* @param {vec3} v the point to which find the nearest
	* @param {vec3} out where to store the nearest point
	* @param {number} minDist the minimum distance to check
	* @param {vec3} normal [optional] where to store the nearest point normal
	* @return {number} the distance to the nearest point found
	*/
	findNearestPoint( v: Vec3Like, out: Float32Array, minDist?: number, normal?: Float32Array | null ): number
	{
		minDist = minDist || Infinity;
		if(v === out)
			throw("findNearestPoint input point and output cannot be the same");
		if(!this.root)
			throw("Error: octree not build");
		return Octree.nearestInNode( this.root, v, out, minDist, normal );
	}

	static nearestInNode( node: OctreeNode, origin: Vec3Like, out: Float32Array, minDist: number, normal?: Float32Array | null ): number
	{
		octree_tested_boxes += 1;
		const current = vec3.create(); //needs to be created
		let currentNormal: Float32Array | undefined;
		if(normal)
			currentNormal = vec3.create(); //needs to be created

		//test faces
		if(node.faces)
			for(let i = 0, l = node.faces.length; i < l; ++i)
			{
				const face = node.faces[i];
				octree_tested_triangles += 1;
				const A = face.subarray(0,3);
				const B = face.subarray(3,6);
				const C = face.subarray(6,9);
				Octree.closestPointOnTriangle( origin, A, B, C, current );
				const dist = vec3.dist(current, origin);
				if(dist < minDist)
				{
					minDist = dist;
					vec3.copy(out, current);
					if(normal)
						geo.computeTriangleNormal( normal,  A, B, C );
				}
			}

		//test children nodes faces
		if(!node.c)
			return minDist;

		for(let i = 0; i < node.c.length; ++i)
		{
			//test if AABB is further of minDist
			const child = node.c[i];

			//test with node box
			const distToAABB = Octree.distanceToBox( origin, child.min, child.max );
			if( distToAABB > minDist)
				continue;

			//test collision with node content
			const dist = Octree.nearestInNode( child, origin, current, minDist, currentNormal );
			if(dist < minDist)
			{
				minDist = dist;
				vec3.copy(out, current);
				if(normal && currentNormal)
					vec3.copy( normal, currentNormal );
			}
		}

		return minDist;
	}

	static closestPointOnTriangle( p: Vec3Like, a: Vec3Like, b: Vec3Like, c: Vec3Like, out: Float32Array ): Float32Array
	{
		geo.planeFromTriangle(_cp_plane,a,b,c);
		if(vec3.length(_cp_plane) > 0.00000001) //in case is an aberrated triangle, although that case is controlled
		{
			geo.projectPointOnPlane(p, a, _cp_plane, _cp_point);

			//inside
			if (geo.isPointInsideTriangle(_cp_point,a,b,c)) {
				vec3.copy(out, _cp_point);
				return out;
			}
		}

		//check edges
		geo.closestPointToSegment(_cp_point, a, b, _cp_c1);
		geo.closestPointToSegment(_cp_point, b, c, _cp_c2);
		geo.closestPointToSegment(_cp_point, c, a, _cp_c3);
		const mag1 = vec3.sqrDist(_cp_point, _cp_c1);
		const mag2 = vec3.sqrDist(_cp_point, _cp_c2);
		const mag3 = vec3.sqrDist(_cp_point, _cp_c3);

		const min = Math.min(mag1, mag2, mag3);
		if (min === mag1)
			vec3.copy(out,_cp_c1);
		else if (min === mag2)
			vec3.copy(out,_cp_c2);
		else
			vec3.copy(out,_cp_c3);
		return out;
	}

	//test if one bounding is inside or overlapping another bounding
	static isInsideAABB( a: AABB, b: OctreeNode ): boolean
	{
		if(a.min[0] < b.min[0] || a.min[1] < b.min[1] || a.min[2] < b.min[2] ||
			a.max[0] > b.max[0] || a.max[1] > b.max[1] || a.max[2] > b.max[2])
			return false;
		return true;
	}

	//from https://iquilezles.org/articles/distfunctions/
	static distanceToBox( point: NumberArray, min: NumberArray, max: NumberArray ): number
	{
		const centerx = (max[0] + min[0]) * 0.5;
		const centery = (max[1] + min[1]) * 0.5;
		const centerz = (max[2] + min[2]) * 0.5;
		const halfsizex = max[0] - centerx;
		const halfsizey = max[1] - centery;
		const halfsizez = max[2] - centerz;
		let x = Math.abs(point[0] - centerx) - halfsizex;
		let y = Math.abs(point[1] - centery) - halfsizey;
		let z = Math.abs(point[2] - centerz) - halfsizez;
		const d = Math.min(Math.max(x,y,z),0.0);
		x = Math.max(x,0.0);
		y = Math.max(y,0.0);
		z = Math.max(z,0.0);
		return Math.sqrt(x*x + y*y + z*z) + d;
	}

	static hitTestBox( origin: Float32Array, ray: Float32Array, box_min: Float32Array, box_max: Float32Array ): HitTest | null
	{
		vec3.subtract( _hb_tMin, box_min, origin );
		vec3.subtract( _hb_tMax, box_max, origin );

		if(	vec3.maxValue(_hb_tMin) < 0 && vec3.minValue(_hb_tMax) > 0)
			return new HitTest(0,origin,ray);

		_hb_inv[0] = 1/ray[0];	_hb_inv[1] = 1/ray[1];	_hb_inv[2] = 1/ray[2];
		vec3.multiply(_hb_tMin, _hb_tMin, _hb_inv);
		vec3.multiply(_hb_tMax, _hb_tMax, _hb_inv);
		vec3.min(_hb_t1, _hb_tMin, _hb_tMax);
		vec3.max(_hb_t2, _hb_tMin, _hb_tMax);
		const tNear = vec3.maxValue(_hb_t1);
		const tFar = vec3.minValue(_hb_t2);

		if (tNear > 0 && tNear < tFar) {
			const hit = vec3.add( vec3.create(), vec3.scale(_hb_tmp, ray, tNear ), origin);
			vec3.add( box_min, box_min, _hb_eps);
			vec3.subtract(box_min, box_min, _hb_eps);
			return new HitTest(tNear, hit, vec3.fromValues(
			  Number(hit[0] > box_max[0]) - Number(hit[0] < box_min[0]),
			  Number(hit[1] > box_max[1]) - Number(hit[1] < box_min[1]),
			  Number(hit[2] > box_max[2]) - Number(hit[2] < box_min[2]) ));
		}

		return null;
	}

	static hitTestTriangle( origin: Float32Array, ray: Float32Array, A: Float32Array, B: Float32Array, C: Float32Array, test_backfaces?: boolean ): HitTest | null
	{
		vec3.subtract( _ht_AB, B, A );
		vec3.subtract( _ht_AC, C, A );
		const normal = vec3.cross( vec3.create(), _ht_AB, _ht_AC ); //returned
		vec3.normalize( normal, normal );
		if( !test_backfaces && vec3.dot(normal,ray) > 0)
			return null; //ignore backface

		const t = vec3.dot(normal, vec3.subtract( _ht_tmp, A, origin )) / vec3.dot(normal,ray);

	    if (t > 0)
		{
			const hit = vec3.scale(vec3.create(), ray, t); //returned
			vec3.add(hit, hit, origin);
			vec3.subtract( _ht_toHit, hit, A );
			const dot00 = vec3.dot(_ht_AC,_ht_AC);
			const dot01 = vec3.dot(_ht_AC,_ht_AB);
			const dot02 = vec3.dot(_ht_AC,_ht_toHit);
			const dot11 = vec3.dot(_ht_AB,_ht_AB);
			const dot12 = vec3.dot(_ht_AB,_ht_toHit);
			const divide = dot00 * dot11 - dot01 * dot01;
			const u = (dot11 * dot02 - dot01 * dot12) / divide;
			const v = (dot00 * dot12 - dot01 * dot02) / divide;
			if (u >= 0 && v >= 0 && u + v <= 1)
				return new HitTest(t, hit, normal);
		}
	    return null;
	}

	//from http://realtimecollisiondetection.net/blog/?p=103
	//radius must be squared
	static testSphereTriangle( P: NumberArray, rr: number, A_: NumberArray, B_: NumberArray, C_: NumberArray ): boolean
	{
		vec3.sub( _st_A, A_, P );
		vec3.sub( _st_B, B_, P );
		vec3.sub( _st_C, C_, P );

		vec3.sub( _st_AB, _st_B, _st_A );
		vec3.sub( _st_AC, _st_C, _st_A );

		vec3.cross( _st_V, _st_AB, _st_AC );
		const d = vec3.dot( _st_A, _st_V );
		const e = vec3.dot( _st_V, _st_V );
		const sep1 = Number(d * d > rr * e);
		const aa = vec3.dot(_st_A, _st_A);
		const ab = vec3.dot(_st_A, _st_B);
		const ac = vec3.dot(_st_A, _st_C);
		const bb = vec3.dot(_st_B, _st_B);
		const bc = vec3.dot(_st_B, _st_C);
		const cc = vec3.dot(_st_C, _st_C);
		const sep2 = Number(aa > rr) & Number(ab > aa) & Number(ac > aa);
		const sep3 = Number(bb > rr) & Number(ab > bb) & Number(bc > bb);
		const sep4 = Number(cc > rr) & Number(ac > cc) & Number(bc > cc);

		const d1 = ab - aa;
		const d2 = bc - bb;
		const d3 = ac - cc;

		vec3.sub( _st_BC, _st_C, _st_B );
		vec3.sub( _st_CA, _st_A, _st_C );

		const e1 = vec3.dot(_st_AB, _st_AB);
		const e2 = vec3.dot(_st_BC, _st_BC);
		const e3 = vec3.dot(_st_CA, _st_CA);

		const Q1 = vec3.scale(vec3.create(), _st_A, e1); vec3.sub( Q1, Q1, vec3.scale(vec3.create(), _st_AB, d1) );
		const Q2 = vec3.scale(vec3.create(), _st_B, e2); vec3.sub( Q2, Q2, vec3.scale(vec3.create(), _st_BC, d2) );
		const Q3 = vec3.scale(vec3.create(), _st_C, e3); vec3.sub( Q3, Q3, vec3.scale(vec3.create(), _st_CA, d3) );

		const QC = vec3.sub( vec3.create(), vec3.scale( vec3.create(), _st_C, e1 ), Q1 );
		const QA = vec3.sub( vec3.create(), vec3.scale( vec3.create(), _st_A, e2 ), Q2 );
		const QB = vec3.sub( vec3.create(), vec3.scale( vec3.create(), _st_B, e3 ), Q3 );

		const sep5 = Number( vec3.dot(Q1, Q1) > rr * e1 * e1) & Number(vec3.dot(Q1, QC) > 0 );
		const sep6 = Number( vec3.dot(Q2, Q2) > rr * e2 * e2) & Number(vec3.dot(Q2, QA) > 0 );
		const sep7 = Number( vec3.dot(Q3, Q3) > rr * e3 * e3) & Number(vec3.dot(Q3, QB) > 0 );

		const separated = sep1 | sep2 | sep3 | sep4 | sep5 | sep6 | sep7
		return !separated;
	}

	static testSphereBox( center: NumberArray, radius2: number, box_min: NumberArray, box_max: NumberArray ): boolean
	{
		// arvo's algorithm from gamasutra
		// http://www.gamasutra.com/features/19991018/Gomez_4.htm
		let s: number, d = 0.0;
		//find the square of the distance
		//from the sphere to the box
		for(let i = 0; i < 3; ++i)
		{
			if( center[i] < box_min[i] )
			{
				s = center[i] - box_min[i];
				d += s*s;
			}
			else if( center[i] > box_max[i] )
			{
				s = center[i] - box_max[i];
				d += s*s;
			}
		}
		//return d <= r*r

		if (d <= radius2)
		{
			return true;
			/*
			// this is used just to know if it overlaps or is just inside, but I dont care
			// make an aabb aabb test with the sphere aabb to test inside state
			var halfsize = vec3.fromValues( radius, radius, radius );
			var sphere_bbox = BBox.fromCenterHalfsize( center, halfsize );
			if ( geo.testBBoxBBox(bbox, sphere_bbox) )
				return INSIDE;
			return OVERLAP;
			*/
		}

		return false; //OUTSIDE;
	}
}
