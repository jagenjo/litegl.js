/**
* LEvent is a lightweight events library focused in low memory footprint
* @class LEvent
* @constructor
*/

var LEvent = global.LEvent = GL.LEvent = {
	//map: new Weakmap(),

	/**
	* Binds an event to an instance
	* @method LEvent.bind
	* @param {Object} instance where to attach the event
	* @param {String} event_name string defining the event name
	* @param {function} callback function to call when the event is triggered
	* @param {Object} target_instance [Optional] instance to call the function (use this instead of .bind method to help removing events)
	**/
	bind: function( instance, event_type, callback, target_instance )
	{
		if(!instance) 
			throw("cannot bind event to null");
		if(!callback) 
			throw("cannot bind to null callback");
		if(instance.constructor === String ) 
			throw("cannot bind event to a string");

		var events = instance.__events;
		if(!events)
			events = instance.__events = {};

		if( events.hasOwnProperty( event_type ) )
			events[event_type].push([callback,target_instance]);
		else
			events[event_type] = [[callback,target_instance]];
	},

	/**
	* Unbinds an event from an instance
	* @method LEvent.unbind
	* @param {Object} instance where the event is binded
	* @param {String} event_name string defining the event name
	* @param {function} callback function that was binded
	* @param {Object} target_instance [Optional] target_instance that was binded
	**/
	unbind: function( instance, event_type, callback, target_instance )
	{
		if(!instance) 
			throw("cannot unbind event to null");
		if(!callback) 
			throw("cannot unbind from null callback");
		if(instance.constructor === String ) 
			throw("cannot bind event to a string");

		var events = instance.__events;
		if(!events)
			return;

		if(!events.hasOwnProperty( event_type ))
			return;

		for(var i = 0, l = events[event_type].length; i < l; ++i)
		{
			var v = events[event_type][i];
			if(v[0] === callback && v[1] === target_instance)
			{
				events[event_type].splice( i, 1 );
				break;
			}
		}

		if (events[event_type].length == 0)
			delete events[event_type];
	},

	/**
	* Unbinds all events from an instance (or the ones that match certain target_instance)
	* @method LEvent.unbindAll
	* @param {Object} instance where the events are binded
	* @param {Object} target_instance [Optional] target_instance of the events to remove
	**/
	unbindAll: function( instance, target_instance )
	{
		if(!instance) 
			throw("cannot unbind events in null");

		var events = instance.__events;
		if(!events)
			return;

		if(!target_instance) //remove all
		{
			delete instance.__events;
			return;
		}

		//remove only the target_instance
		//for every property in the instance
		for(var i in events)
		{
			var array = events[i];
			for(var j = array.length - 1; j >= 0; --j) //iterate backwards to avoid problems after removing
			{
				if( array[j][1] != target_instance ) 
					continue;
				array.splice(j,1);//remove
			}

			//if(array.length == 0) //add two passes to avoid read and delete
			//	delete events[i];
		}
	},

	/**
	* Tells if there is a binded callback that matches the criteria
	* @method LEvent.isBind
	* @param {Object} instance where the are the events binded
	* @param {String} event_name string defining the event name
	* @param {function} callback the callback
	* @param {Object} target_instance [Optional] instance binded to callback
	**/
	isBind: function( instance, event_type, callback, target_instance )
	{
		if(!instance)
			throw("LEvent cannot have null as instance");

		var events = instance.__events;
		if( !events )
			return;

		if( !events.hasOwnProperty(event_type) ) 
			return false;

		for(var i = 0, l = events[event_type].length; i < l; ++i)
		{
			var v = events[event_type][i];
			if(v[0] === callback && v[1] === target_instance)
				return true;
		}
		return false;
	},

	/**
	* Tells if there is any callback binded to this event
	* @method LEvent.hasBind
	* @param {Object} instance where the are the events binded
	* @param {String} event_name string defining the event name
	* @return {boolean} true is there is at least one
	**/
	hasBind: function( instance, event_type )
	{
		if(!instance)
			throw("LEvent cannot have null as instance");
		var events = instance.__events;
		if(!events || !events.hasOwnProperty( event_type ) || !events[event_type].length) 
			return false;
		return true;
	},

	/**
	* Tells if there is any callback binded to this object pointing to a method in the target object
	* @method LEvent.hasBindTo
	* @param {Object} instance where there are the events binded
	* @param {Object} target instance to check to
	* @return {boolean} true is there is at least one
	**/
	hasBindTo: function( instance, target )
	{
		if(!instance)
			throw("LEvent cannot have null as instance");
		var events = instance.__events;

		//no events binded
		if(!events || !events.hasOwnProperty( event_type ) || !events[event_type].length) 
			return false;

		var binds = events[event_type];
		for(var i = 0; i < binds.length; ++i)
		{
			if(binds[i][1] == target) //one found
				return true;
		}

		return false;
	},

	/**
	* Triggers and event in an instance
	* @method LEvent.trigger
	* @param {Object} instance that triggers the event
	* @param {String} event_name string defining the event name
	* @param {*} parameters that will be received by the binded function
	**/
	trigger: function( instance, event_type, params )
	{
		if(!instance) 
			throw("cannot trigger event from null");
		if(instance.constructor === String ) 
			throw("cannot bind event to a string");

		var events = instance.__events;
		if( !events || !events.hasOwnProperty(event_type) )
			return true;

		var inst = events[event_type];
		for(var i = 0, l = inst.length; i < l; ++i)
		{
			var v = inst[i];
			if( v && v[0].call(v[1], event_type, params) == false)// || event.stop)
				return false; //stopPropagation
		}

		return true;
	},

	/**
	* Triggers and event to every element in an array
	* @method LEvent.triggerArray
	* @param {Array} array contains all instances to triggers the event
	* @param {String} event_name string defining the event name
	* @param {*} parameters that will be received by the binded function
	**/
	triggerArray: function( instances, event_type, params )
	{
		for(var i = 0, l = instances.length; i < l; ++i)
		{
			var instance = instances[i];
			if(!instance) 
				throw("cannot trigger event from null");
			if(instance.constructor === String ) 
				throw("cannot bind event to a string");

			var events = instance.__events;
			if( !events || !events.hasOwnProperty( event_type ) )
				continue;

			for(var j = 0, ll = events[event_type].length; j < ll; ++j)
			{
				var v = events[event_type][j];
				if( v[0].call(v[1], event_type, params) == false)// || event.stop)
					break; //stopPropagation
			}
		}

		return true;
	}
};

// NOT FINISHED, STILL HAS SOME ISSUES TO SOLVE, TEST OR DELETE
//There is a secondary implementation using WeakMap, this implementation clears the events from the objects
//and moves them to one global object, so objects are not constantly changing, but I must test performance.
/*
if(global.WeakMap && 0)
{
	(function(){

	//local scope
	var map = new WeakMap;

	LEvent.bind = function( instance, event_type, callback, target_instance )
	{
		if(!instance) 
			throw("cannot bind event to null");
		if(!callback) 
			throw("cannot bind to null callback");
		if(instance.constructor === String ) 
			throw("cannot bind event to a string");
		var name = event_type;

		var obj = map[instance];
		if(!obj)
			obj = map[instance] = {};

		if(obj.hasOwnProperty(name))
			obj[name].push([callback,target_instance]);
		else
			obj[name] = [[callback,target_instance]];
	}

	LEvent.unbind = function( instance, event_type, callback, target_instance )
	{
		if(!instance) 
			throw("cannot unbind event to null");
		if(!callback) 
			throw("cannot unbind from null callback");
		if(instance.constructor === String ) 
			throw("cannot bind event to a string");

		var obj = map[instance];
		if(!obj)
			return;

		var name = event_type;
		if(!obj[name]) 
			return;

		for(var i = 0, l = obj[name].length; i < l; ++i)
		{
			var v = obj[name][i];
			if(v[0] === callback && v[1] === target_instance)
			{
				obj[name].splice( i, 1);
				break;
			}
		}

		if (obj[name].length == 0)
			delete obj[name];
	},

	LEvent.unbindAll = function(instance, target_instance)
	{
		if(!instance) 
			throw("cannot unbind events in null");
		if(!target_instance) //remove all
		{
			map.delete(instance);
			return;
		}

		//remove only the target_instance
		//for every property in the instance
		var obj = map[instance];
		if(!obj)
			return;

		for(var i in obj)
		{
			var array = obj[i];
			for(var j=0; j < array.length; ++j)
			{
				if( array[j][1] != target_instance ) 
					continue;
				array.splice(j,1);//remove
				--j;//iterate from the gap
			}

			if(array.length == 0)
				delete obj[i];
		}
	}

	LEvent.isBind = function( instance, event_type, callback, target_instance )
	{
		var name = event_type;
		var obj = map[instance];
		if(!obj || !obj.hasOwnProperty(name)) 
			return false;
		for(var i = 0, l = obj[name].length; i < l; ++i)
		{
			var v = obj[name][i];
			if(v[0] === callback && v[1] === target_instance)
				return true;
		}
		return false;
	}

	LEvent.trigger = function( instance, event_type, params, skip_jquery )
	{
		if(!instance) 
			throw("cannot trigger event from null");
		if(instance.constructor === String ) 
			throw("cannot bind event to a string");

		

		//you can resend the events as jQuery events, but to avoid collisions with system events, we use ":" at the begining
		if(LEvent.jQuery && !skip_jquery)
			$(instance).trigger( ":" + event_type, params );

		var name = event_type;

		var obj = map[instance];

		if(!obj.hasOwnProperty(name)) 
			return;
		var inst = obj[name];
		for(var i = 0, l = inst.length; i < l; ++i)
		{
			var v = inst[i];
			if( v[0].call(v[1], event_type, params) == false)// || event.stop)
				break; //stopPropagation
		}
	}

	LEvent.triggerArray = function( instances, event_type, params, skip_jquery )
	{
		for(var i = 0, l = instances.length; i < l; ++i)
		{
			var instance = instances[i];
			if(!instance) 
				throw("cannot trigger event from null");
			if(instance.constructor === String ) 
				throw("cannot bind event to a string");

			var obj = map[instance];

			//you can resend the events as jQuery events, but to avoid collisions with system events, we use ":" at the begining
			if(LEvent.jQuery && !skip_jquery) 
				$(instance).trigger( ":" + event_type, params );

			var name = event_type;
			if(!obj.hasOwnProperty(name)) 
				continue;
			for(var j = 0, l = obj[name].length; j < l; ++j)
			{
				var v = obj[name][j];
				if( v[0].call(v[1], event_type, params) == false)// || event.stop)
					break; //stopPropagation
			}
		}
	}


	})(); //local scope end
}
*/