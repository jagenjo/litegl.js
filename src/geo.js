/* geometric utilities */
var geo = {

	createPlane: function(P,N)
	{
		return new Float32Array([N[0],N[1],N[2],-vec3.dot(P,N)]);
	},

	distancePointToPlane: function(point, plane)
	{
		return (vec3.dot(point,plane) + plane[3])/Math.sqrt(plane[0]*plane[0] + plane[1]*plane[1] + plane[2]*plane[2]);
	},

	//for sorting
	distance2PointToPlane: function(point, plane)
	{
		return (vec3.dot(point,plane) + plane[3])/(plane[0]*plane[0] + plane[1]*plane[1] + plane[2]*plane[2]);
	},

	projectPointOnPlane: function(point, P, N, result)
	{
		result = result || vec3.create();
		var v = vec3.subtract( vec3.create(), point, P );
		var dist = vec3.dot(v,N);
		return vec3.subtract( result, point , vec3.scale( vec3.create(), N, dist ) );
	},

	reflectPointInPlane: function(point, P, N)
	{
		var d = -1 * (P[0] * N[0] + P[1] * N[1] + P[2] * N[2]);
		var t = -(d + N[0]*point[0] + N[1]*point[1] + N[2]*point[2]) / (N[0]*N[0] + N[1]*N[1] + N[2]*N[2]);
		//trace("T:" + t);
		//var closest = [ point[0]+t*N[0], point[1]+t*N[1], point[2]+t*N[2] ];
		//trace("Closest:" + closest);
		return vec3.fromValues( point[0]+t*N[0]*2, point[1]+t*N[1]*2, point[2]+t*N[2]*2 );
	},

	testRayPlane: function(start, direction, P, N, result)
	{
		var D = vec3.dot( P, N );
		var numer = D - vec3.dot(N, start);
		var denom = vec3.dot(N, direction);
		if( Math.abs(denom) < EPSILON) return false;
		var t = (numer / denom);
		if(t < 0.0) return false; //behind the ray
		if(result)
			vec3.add( result,  start, vec3.scale( vec3.create(), direction, t) );

		return true;
	},

	testRayBox: function(start, direction, minB, maxB, result)
	{
	//#define NUMDIM	3
	//#define RIGHT	0
	//#define LEFT	1
	//#define MIDDLE	2

		result = result || vec3.create();

		var inside = true;
		var quadrant = new Float32Array(3);
		var i;
		var whichPlane;
		var maxT = new Float32Array(3);
		var candidatePlane = new Float32Array(3);

		/* Find candidate planes; this loop can be avoided if
		rays cast all from the eye(assume perpsective view) */
		for (i=0; i < 3; i++)
			if(start[i] < minB[i]) {
				quadrant[i] = 1;
				candidatePlane[i] = minB[i];
				inside = false;
			}else if (start[i] > maxB[i]) {
				quadrant[i] = 0;
				candidatePlane[i] = maxB[i];
				inside = false;
			}else	{
				quadrant[i] = 2;
			}

		/* Ray origin inside bounding box */
		if(inside)	{
			vec3.copy(result, start);
			return true;
		}


		/* Calculate T distances to candidate planes */
		for (i = 0; i < 3; i++)
			if (quadrant[i] != 2 && direction[i] != 0.)
				maxT[i] = (candidatePlane[i] - start[i]) / direction[i];
			else
				maxT[i] = -1.;

		/* Get largest of the maxT's for final choice of intersection */
		whichPlane = 0;
		for (i = 1; i < 3; i++)
			if (maxT[whichPlane] < maxT[i])
				whichPlane = i;

		/* Check final candidate actually inside box */
		if (maxT[whichPlane] < 0.) return false;
		for (i = 0; i < 3; i++)
			if (whichPlane != i) {
				result[i] = start[i] + maxT[whichPlane] * direction[i];
				if (result[i] < minB[i] || result[i] > maxB[i])
					return false;
			} else {
				result[i] = candidatePlane[i];
			}
		return true;				/* ray hits box */
	},

	testRaySphere: function(start, direction, center, radius, result)
	{
		// sphere equation (centered at origin) x2+y2+z2=r2
		// ray equation x(t) = p0 + t*dir
		// substitute x(t) into sphere equation
		// solution below:

		// transform ray origin into sphere local coordinates
		var orig = vec3.subtract(vec3.create(), start, center);

		var a = direction[0]*direction[0] + direction[1]*direction[1] + direction[2]*direction[2];
		var b = 2*orig[0]*direction[0] + 2*orig[1]*direction[1] + 2*orig[2]*direction[2];
		var c = orig[0]*orig[0] + orig[1]*orig[1] + orig[2]*orig[2] - radius*radius;
		//return quadraticFormula(a,b,c,t0,t1) ? 2 : 0;

		var q = b*b - 4*a*c; 
		if( q < 0.0 )
			return false;

		if(result)
		{
			var sq = Math.sqrt(q);
			var d = 1 / (2*a);
			var r1 = ( -b + sq ) * d;
			var r2 = ( -b - sq ) * d;
			var t = r1 < r2 ? r1 : r2;
			vec3.add(result, start, vec3.scale( vec3.create(), direction, t ) );
		}
		return true;//real roots
	},

	testRayCylinder: function(start, direction, p, q, r, result)
	{
		var sa = vec3.clone(start);
		var sb = vec3.add(vec3.create(), start, vec3.scale( vec3.create(), direction, 100000) );
		var t = 0;
		var d = vec3.subtract(vec3.create(),q,p);
		var m = vec3.subtract(vec3.create(),sa,p);
		var n = vec3.subtract(vec3.create(),sb,sa);
		//var n = vec3.create(direction);

		var md = vec3.dot(m, d);
		var nd = vec3.dot(n, d);
		var dd = vec3.dot(d, d);

		// Test if segment fully outside either endcap of cylinder
		if (md < 0.0 && md + nd < 0.0) return false; // Segment outside ’p’ side of cylinder
		if (md > dd && md + nd > dd) return false; // Segment outside ’q’ side of cylinder

		var nn = vec3.dot(n, n);
		var mn = vec3.dot(m, n);
		var a = dd * nn - nd * nd; 
		var k = vec3.dot(m,m) - r*r;
		var c = dd * k - md * md;

		if (Math.abs(a) < EPSILON) 
		{
			// Segment runs parallel to cylinder axis
			if (c > 0.0) return false;
			// ’a’ and thus the segment lie outside cylinder
			// Now known that segment intersects cylinder; figure out how it intersects
			if (md < 0.0) t = -mn/nn;
			// Intersect segment against ’p’ endcap
			else if (md > dd)
				t=(nd-mn)/nn;
			// Intersect segment against ’q’ endcap
			else t = 0.0;
			// ’a’ lies inside cylinder
			if(result) vec3.add(result, sa, vec3.scale(vec3.create(), n,t) );
			return true;
		}
		var b = dd * mn - nd * md;
		var discr = b*b - a*c;
		if (discr < 0.0) 
			return false;
		// No real roots; no intersection
		t = (-b - Math.sqrt(discr)) / a;
		if (t < 0.0 || t > 1.0) 
			return false;
		// Intersection lies outside segment
		if(md+t*nd < 0.0)
		{
			// Intersection outside cylinder on ’p’ side
			if (nd <= 0.0) 
				return false;
			// Segment pointing away from endcap
			t = -md / nd;
			// Keep intersection if Dot(S(t) - p, S(t) - p) <= r^2
			if(result) vec3.add(result, sa, vec3.scale(vec3.create(), n,t) );

			return k+2*t*(mn+t*nn) <= 0.0;
		} else if (md+t*nd>dd)
		{
			// Intersection outside cylinder on ’q’ side
			if (nd >= 0.0) return false; //Segment pointing away from endcap
			t = (dd - md) / nd;
			// Keep intersection if Dot(S(t) - q, S(t) - q) <= r^2
			if(result) vec3.add(result, sa, vec3.scale(vec3.create(), n,t) );
			return k+dd - 2*md+t*(2*(mn - nd)+t*nn) <= 0.0;
		}
		// Segment intersects cylinder between the endcaps; t is correct
		if(result) vec3.add(result, sa, vec3.scale(vec3.create(), n,t) );
		return true;
	},

	closestPointBetweenLines: function(a0,a1, b0,b1, p_a, p_b)
	{
		var u = vec3.subtract( vec3.create(), a1, a0 );
		var v = vec3.subtract( vec3.create(), b1, b0 );
		var w = vec3.subtract( vec3.create(), a0, b0 );

		var a = vec3.dot(u,u);         // always >= 0
		var b = vec3.dot(u,v);
		var c = vec3.dot(v,v);         // always >= 0
		var d = vec3.dot(u,w);
		var e = vec3.dot(v,w);
		var D = a*c - b*b;        // always >= 0
		var sc, tc;

		// compute the line parameters of the two closest points
		if (D < EPSILON) {          // the lines are almost parallel
			sc = 0.0;
			tc = (b>c ? d/b : e/c);    // use the largest denominator
		}
		else {
			sc = (b*e - c*d) / D;
			tc = (a*e - b*d) / D;
		}

		// get the difference of the two closest points
		if(p_a)	vec3.add(p_a, a0, vec3.scale(vec3.create(),u,sc));
		if(p_b)	vec3.add(p_b, b0, vec3.scale(vec3.create(),v,tc));

		var dP = vec3.add( vec3.create(), w, vec3.subtract( vec3.create(), vec3.scale(vec3.create(),u,sc) , vec3.scale(vec3.create(),v,tc)) );  // =  L1(sc) - L2(tc)
		return vec3.length(dP);   // return the closest distance
	}
};

//[center,half,min,max]

//  NOT TESTED YET!!!!!!!

var BBox = {
	center:0,
	halfsize:3,
	min:6,
	max:9,

	corners: new Float32Array([1,1,1,  1,1,-1,  1,-1,1,  1,-1,-1,  -1,1,1,  -1,1,-1,  -1,-1,1,  -1,-1,-1 ]),

	create: function()
	{
		return new Float32Array(12);
	},

	clone: function(bb)
	{
		return new Float32Array(bb);
	},

	fromPoint: function(point)
	{
		var bb = this.create();
		bb.set(point, 0); //center
		bb.set(point, 6); //min
		bb.set(point, 9); //max
		return bb;
	},

	fromMinMax: function(min,max)
	{
		var bb = this.create();
		this.setMinMax(bb, min, max);
		return bb;
	},

	fromCenterHalfsize: function(center, halfsize)
	{
		var bb = this.create();
		this.setCenterHalfsize(bb, center, halfsize);
		return bb;
	},

	fromPoints: function(points)
	{
		var bb = this.create();
		this.setFromPoints(bb, points);
		return bb;	
	},

	setFromPoints: function(bb, points)
	{
		var min = bb.subarray(6,9);
		var max = bb.subarray(9,12);

		min.set( points.subarray(0,3) );
		min.set( points.subarray(0,3) );

		var v = 0;
		for(var i = 3; i < points.length; i+=3)
		{
			v = points.subarray(i,i+3);
			vec3.min( min, v, min);
			vec3.max( max, v, max);
		}

		var center = vec3.add( bb.subarray(0,3), min, max );
		vec3.scale( center, center, 0.5);
		vec3.subtract( bb.subarray(3,6), max, center );	
	},

	setMinMax: function(bb, min, max)
	{
		bb.set(min, 6); //min
		bb.set(max, 9); //max
		var center = bb.subarray(0,3);
		vec3.sub( center, max, min );
		vec3.scale( center, center, 0.5 );
		bb.set( [max[0]-center[0],max[1]-center[1],max[2]-center[2]], 3);
		vec3.sub( bb.subarray(3,6), max, center );
	},

	setCenterHalfsize: function(bb, center, halfsize)
	{
		bb.set(center, 0); //min
		bb.set(halfsize, 3); //max
		vec3.sub(bb.subarray(6,9), bb.subarray(0,3), bb.subarray(3,6) );
		vec3.add(bb.subarray(9,12), bb.subarray(0,3), bb.subarray(3,6) );
	},

	transformMat4: function(out, bb, mat)
	{
		var center = bb.subarray(0,3);
		var halfsize = bb.subarray(3,6);
		var corners = new Float32Array( this.corners );

		for(var i = 0; i < 8; ++i)		
		{
			var corner = corners.subarray(i*3, i*3+3);
			vec3.multiply( corner, halfsize, corner );
			vec3.add( corner, corner, center );
			mat4.multiplyVec3(corner, mat, corner);
		}

		return this.setFromPoints(out, corners);
	},

	getCenter: function(bb) { return bb.subarray(0,3); },
	getHalfsize: function(bb) { return bb.subarray(3,6); },
	getMin: function(bb) { return bb.subarray(6,9); },
	getMax: function(bb) { return bb.subarray(9,12); }
}

//extract the frustrum planes from viewprojection matrix
geo.extractPlanes = function(vp)
{
	var planes = new Float32Array(4*6);

	//right
	planes.set( [vp[3] - vp[0], vp[7] - vp[4], vp[11] - vp[8], vp[15] - vp[12] ], 0); 
	normalize(0);

	//left
	planes.set( [vp[3] + vp[0], vp[ 7] + vp[ 4], vp[11] + vp[ 8], vp[15] + vp[12] ], 4);
	normalize(4);

	//bottom
	planes.set( [ vp[ 3] + vp[ 1], vp[ 7] + vp[ 5], vp[11] + vp[ 9], vp[15] + vp[13] ], 8);
	normalize(8);

	//top
	planes.set( [ vp[ 3] - vp[ 1], vp[ 7] - vp[ 5], vp[11] - vp[ 9], vp[15] - vp[13] ],12);
	normalize(12);

	//back
	planes.set( [ vp[ 3] - vp[ 2], vp[ 7] - vp[ 6], vp[11] - vp[10], vp[15] - vp[14] ],16);
	normalize(16);

	//front
	planes.set( [ vp[ 3] + vp[ 2], vp[ 7] + vp[ 6], vp[11] + vp[10], vp[15] + vp[14] ],20);
	normalize(20);

	return planes;

	function normalize(pos)
	{
		var N = planes.subarray(pos,pos+3);
		var l = vec3.length(N);
		if(l) return;
		l = 1.0 / l;
		planes[pos] *= l;
		planes[pos+1] *= l;
		planes[pos+2] *= l;
		planes[pos+3] *= l;
	}
}

var CLIP_INSIDE = 0;
var CLIP_OUTSIDE = 1;
var CLIP_OVERLAP = 2;

geo.frustrumTestBox = function(planes, box)
{
	var flag = 0, o = 0;

	flag = planeBoxOverlap(planes.subarray(0,4),box);
	if (flag == CLIP_OUTSIDE) return CLIP_OUTSIDE; o+= flag;
	flag =  planeBoxOverlap(planes.subarray(4,8),box);
	if (flag == CLIP_OUTSIDE) return CLIP_OUTSIDE; o+= flag;
	flag =  planeBoxOverlap(planes.subarray(8,12),box);
	if (flag == CLIP_OUTSIDE) return CLIP_OUTSIDE; o+= flag;
	flag =  planeBoxOverlap(planes.subarray(12,16),box);
	if (flag == CLIP_OUTSIDE) return CLIP_OUTSIDE; o+= flag;
	flag =  planeBoxOverlap(planes.subarray(16,20),box);
	if (flag == CLIP_OUTSIDE) return CLIP_OUTSIDE; o+= flag;
	flag =  planeBoxOverlap(planes.subarray(20,24),box);
	if (flag == CLIP_OUTSIDE) return CLIP_OUTSIDE; o+= flag;

	if (o==0) return CLIP_INSIDE;
	else return CLIP_OVERLAP;
}

geo.frustrumTestSphere = function(planes, center, radius)
{
	var dist;
	var overlap = false;

	dist = distanceToPlane( planes.subarray(0,4), center );
	if( dist < -radius ) return CLIP_OUTSIDE;
	else if(dist >= -radius && dist <= radius)	overlap = true;
	dist = distanceToPlane( planes.subarray(4,8), center );
	if( dist < -radius ) return CLIP_OUTSIDE;
	else if(dist >= -radius && dist <= radius)	overlap = true;
	dist = distanceToPlane( planes.subarray(8,12), center );
	if( dist < -radius ) return CLIP_OUTSIDE;
	else if(dist >= -radius && dist <= radius)	overlap = true;
	dist = distanceToPlane( planes.subarray(12,16), center );
	if( dist < -radius ) return CLIP_OUTSIDE;
	else if(dist >= -radius && dist <= radius)	overlap = true;
	dist = distanceToPlane( planes.subarray(16,20), center );
	if( dist < -radius ) return CLIP_OUTSIDE;
	else if(dist >= -radius && dist <= radius)	overlap = true;
	dist = distanceToPlane( planes.subarray(20,24), center );
	if( dist < -radius ) return CLIP_OUTSIDE;
	else if(dist >= -radius && dist <= radius)	overlap = true;
}

function distanceToPlane(plane, point)
{
	return vec3.dot(plane,point) + plane[3];
}

function planeBoxOverlap(plane, box)
{
	var n = plane.subarray(0,3);
	var d = plane[3];
	var center = box.subarray(0,3);
	var halfsize = box.subarray(3,6);

	var tmp = vec3.fromValues(
		Math.abs( halfsize[0] * n[0]),
		Math.abs( halfsize[1] * n[1]),
		Math.abs( halfsize[2] * n[2])
	);

	var radius = tmp[0]+tmp[1]+tmp[2];
	var distance = vec3.dot(n,center) + d;

	if (distance <= - radius) return CLIP_OUTSIDE;
	else if (distance <= radius) return CLIP_OVERLAP;
	else return CLIP_INSIDE;
}
