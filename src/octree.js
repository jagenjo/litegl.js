/**
*   Octree generator for fast ray triangle collision with meshes
*	Dependencies: glmatrix.js (for vector and matrix operations)
* @class Octree
* @constructor
* @param {Mesh} mesh object containing vertices buffer (indices buffer optional)
*/

function HitTest(t, hit, normal) {
  this.t = arguments.length ? t : Number.MAX_VALUE;
  this.hit = hit;
  this.normal = normal;
}

HitTest.prototype = {
  mergeWith: function(other) {
    if (other.t > 0 && other.t < this.t) {
      this.t = other.t;
      this.hit = other.hit;
      this.normal = other.normal;
    }
  }
};


function Octree(mesh)
{
	this.root = null;
	this.total_depth = 0;
	this.total_nodes = 0;
	if(mesh)
	{
		this.buildFromMesh(mesh);
		this.total_nodes = this.trim();
	}
}

Octree.MAX_NODE_TRIANGLES_RATIO = 0.1;
Octree.MAX_OCTREE_DEPTH = 8;
Octree.OCTREE_MARGIN_RATIO = 0.01;
Octree.OCTREE_MIN_MARGIN = 0.1;

var octree_tested_boxes = 0;
var octree_tested_triangles = 0;

Octree.prototype.buildFromMesh = function(mesh)
{
	this.total_depth = 0;
	this.total_nodes = 0;

	var vertices = mesh.vertices;
	var triangles = mesh.triangles;

	var root = this.computeAABB(vertices);
	this.root = root;
	this.total_nodes = 1;
	this.total_triangles = triangles ? triangles.length / 3 : vertices.length / 9;
	this.max_node_triangles = this.total_triangles * Octree.MAX_NODE_TRIANGLES_RATIO;

	var margin = vec3.create();
	vec3.scale( margin, root.size, Octree.OCTREE_MARGIN_RATIO );
	if(margin[0] < Octree.OCTREE_MIN_MARGIN) margin[0] = Octree.OCTREE_MIN_MARGIN;
	if(margin[1] < Octree.OCTREE_MIN_MARGIN) margin[1] = Octree.OCTREE_MIN_MARGIN;
	if(margin[2] < Octree.OCTREE_MIN_MARGIN) margin[2] = Octree.OCTREE_MIN_MARGIN;

	vec3.sub(root.min, root.min, margin);
	vec3.add(root.max, root.max, margin);

	root.faces = [];
	root.inside = 0;


	//indexed
	if(triangles)
	{
		for(var i = 0; i < triangles.length; i+=3)
		{
			var face = new Float32Array([vertices[triangles[i]*3], vertices[triangles[i]*3+1],vertices[triangles[i]*3+2],
						vertices[triangles[i+1]*3], vertices[triangles[i+1]*3+1],vertices[triangles[i+1]*3+2],
						vertices[triangles[i+2]*3], vertices[triangles[i+2]*3+1],vertices[triangles[i+2]*3+2]]);
			this.addToNode(face,root,0);
			//if(i%3000 == 0) trace("Tris: " + i);
		}
	}
	else
	{
		for(var i = 0; i < vertices.length; i+=9)
		{
			var face = new Float32Array( vertices.subarray(i,i+9) );
			this.addToNode(face,root,0);
			//if(i%3000 == 0) trace("Tris: " + i);
		}
	}

	return root;
}

Octree.prototype.addToNode = function(face,node, depth)
{
	node.inside += 1;

	//has children
	if(node.c)
	{
		var aabb = this.computeAABB(face);
		var added = false;
		for(var i in node.c)
		{
			var child = node.c[i];
			if (Octree.isInsideAABB(aabb,child))
			{
				this.addToNode(face,child, depth+1);
				added = true;
				break;
			}
		}
		if(!added)
		{
			if(node.faces == null) node.faces = [];
			node.faces.push(face);
		}
	}
	else //add till full, then split
	{
		if(node.faces == null) node.faces = [];
		node.faces.push(face);

		//split
		if(node.faces.length > this.max_node_triangles && depth < Octree.MAX_OCTREE_DEPTH)
		{
			this.splitNode(node);
			if(this.total_depth < depth + 1)
				this.total_depth = depth + 1;

			var faces = node.faces.concat();
			node.faces = null;

			//redistribute all nodes
			for(var i in faces)
			{
				var face = faces[i];
				var aabb = this.computeAABB(face);
				var added = false;
				for(var j in node.c)
				{
					var child = node.c[j];
					if (Octree.isInsideAABB(aabb,child))
					{
						this.addToNode(face,child, depth+1);
						added = true;
						break;
					}
				}
				if (!added)
				{
					if(node.faces == null) node.faces = [];
					node.faces.push(face);
				}
			}
		}
	}
};

Octree.prototype.octree_pos_ref = [[0,0,0],[0,0,1],[0,1,0],[0,1,1],[1,0,0],[1,0,1],[1,1,0],[1,1,1]];

Octree.prototype.splitNode = function(node)
{
	node.c = [];
	var half = [(node.max[0] - node.min[0]) * 0.5, (node.max[1] - node.min[1]) * 0.5, (node.max[2] - node.min[2]) * 0.5];

	for(var i in this.octree_pos_ref)
	{
		var ref = this.octree_pos_ref[i];

		var newnode = {};
		this.total_nodes += 1;

		newnode.min = [ node.min[0] + half[0] * ref[0],  node.min[1] + half[1] * ref[1],  node.min[2] + half[2] * ref[2]];
		newnode.max = [newnode.min[0] + half[0], newnode.min[1] + half[1], newnode.min[2] + half[2]];
		newnode.faces = null;
		newnode.inside = 0;
		node.c.push(newnode);
	}
}

Octree.prototype.computeAABB = function(vertices)
{
	var min = new Float32Array([ vertices[0], vertices[1], vertices[2] ]);
	var max = new Float32Array([ vertices[0], vertices[1], vertices[2] ]);

	for(var i = 0; i < vertices.length; i+=3)
	{
		for(var j = 0; j < 3; j++)
		{
			if(min[j] > vertices[i+j]) 
				min[j] = vertices[i+j];
			if(max[j] < vertices[i+j]) 
				max[j] = vertices[i+j];
		}
	}

	return {min: min, max: max, size: vec3.sub( vec3.create(), max, min) };
}

Octree.prototype.trim = function(node)
{
	node = node || this.root;
	if(!node.c)
		return 1;

	var num = 1;
	var valid = [];
	for(var i in node.c)
	{
		if(node.c[i].inside)
		{
			valid.push(node.c[i]);
			num += this.trim(node.c[i]);
		}
	}
	node.c = valid;
	return num;
}

/**
* Uploads a set of uniforms to the Shader
* @method testRay
* @param {vec3} origin ray origin position
* @param {vec3} direction ray direction position
* @param {number} dist_min
* @param {number} dist_max
* @return {HitTest} object containing pos and normal
*/
Octree.prototype.testRay = function(origin, direction, dist_min, dist_max)
{
	origin = vec3.clone(origin);
	direction = vec3.clone(direction);
	//direction = direction.unit();
	octree_tested_boxes = 0;
	octree_tested_triangles = 0;

	if(!this.root)
	{
		throw("Error: octree not build");
	}

	var test = Octree.hitTestBox( origin, direction, vec3.clone(this.root.min), vec3.clone(this.root.max) );
	if(!test) //no collision with mesh bounding box
		return null;

	var test = Octree.testRayInNode(this.root,origin,direction);
	if(test != null)
	{
		var pos = vec3.scale( vec3.create(), direction, test.t );
		vec3.add( pos, pos, origin );
		test.pos = pos;
		return test;
	}

	return null;
}

Octree.testRayInNode = function(node, origin, direction)
{
	var test = null;
	var prev_test = null;
	octree_tested_boxes += 1;

	//test faces
	if(node.faces)
		for(var i = 0, l = node.faces.length; i < l; ++i)
		{
			var face = node.faces[i];
			
			octree_tested_triangles += 1;
			test = Octree.hitTestTriangle(origin,direction, face.subarray(0,3) , face.subarray(3,6), face.subarray(6,9) );
			if (test==null)
				continue;
			if(prev_test)
				prev_test.mergeWith(test);
			else
				prev_test = test;
		}

	//test children nodes faces
	var child;
	if(node.c)
		for(var i in node.c)
		{
			child = node.c[i];
			//test with node box
			test = Octree.hitTestBox( origin, direction, vec3.clone(child.min), vec3.clone(child.max) );
			if( test == null )
				continue;

			//nodebox behind current collision, then ignore node
			if(prev_test && test.t > prev_test.t)
				continue;

			//test collision with node
			test = Octree.testRayInNode(child, origin, direction);
			if(test == null)
				continue;

			if(prev_test)
				prev_test.mergeWith(test);
			else
				prev_test = test;
		}

	return prev_test;
}

//test if one bounding is inside or overlapping another bounding
Octree.isInsideAABB = function(a,b)
{
	if(a.min[0] < b.min[0] || a.min[1] < b.min[1] || a.min[2] < b.min[2] ||
		a.max[0] > b.max[0] || a.max[1] > b.max[1] || a.max[2] > b.max[2])
		return false;
	return true;
}


Octree.hitTestBox = function(origin, ray, box_min, box_max) {
	var tMin = vec3.subtract( vec3.create(), box_min, origin );
	var tMax = vec3.subtract( vec3.create(), box_max, origin );
	
	if(	vec3.maxValue(tMin) < 0 && vec3.minValue(tMax) > 0)
		return new HitTest(0,origin,ray);

	vec3.multiply(tMin, tMin, [1/ray[0],1/ray[1],1/ray[2]]);
	vec3.multiply(tMax, tMax, [1/ray[0],1/ray[1],1/ray[2]]);
	var t1 = vec3.min(vec3.create(), tMin, tMax);
	var t2 = vec3.max(vec3.create(), tMin, tMax);
	var tNear = vec3.maxValue(t1);
	var tFar = vec3.minValue(t2);

	if (tNear > 0 && tNear < tFar) {
		var epsilon = 1.0e-6, hit = vec3.add( vec3.create(), vec3.scale(vec3.create(), ray, tNear ), origin);
		vec3.add(box_min, box_min,[epsilon,epsilon,epsilon]);
		vec3.subtract(box_min, box_min,[epsilon,epsilon,epsilon]);
		return new HitTest(tNear, hit, vec3.fromValues(
		  (hit[0] > box_max[0]) - (hit[0] < box_min[0]),
		  (hit[1] > box_max[1]) - (hit[1] < box_min[1]),
		  (hit[2] > box_max[2]) - (hit[2] < box_min[2]) ));
	}

	return null;
}

Octree.hitTestTriangle = function(origin, ray, a, b, c) {
	var ab = vec3.subtract( vec3.create(), b,a );
	var ac = vec3.subtract( vec3.create(), c,a );
	var normal = vec3.cross( vec3.create(), ab, ac );
	vec3.normalize( normal, normal );
	if( vec3.dot(normal,ray) > 0) return; //ignore backface

	var t = vec3.dot(normal, vec3.subtract( vec3.create(), a, origin )) / vec3.dot(normal,ray);

  if (t > 0) {
	var hit = vec3.scale(vec3.create(), ray, t);
	vec3.add(hit, hit, origin);
	var toHit = vec3.subtract( vec3.create(), hit,a );
	var dot00 = vec3.dot(ac,ac);
	var dot01 = vec3.dot(ac,ab);
	var dot02 = vec3.dot(ac,toHit);
	var dot11 = vec3.dot(ab,ab);
	var dot12 = vec3.dot(ab,toHit);
	var divide = dot00 * dot11 - dot01 * dot01;
	var u = (dot11 * dot02 - dot01 * dot12) / divide;
	var v = (dot00 * dot12 - dot01 * dot02) / divide;
	if (u >= 0 && v >= 0 && u + v <= 1) return new HitTest(t, hit, normal);
  }

  return null;
}
