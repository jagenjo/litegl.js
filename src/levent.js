/**
* LEvent is a lightweight events library focused in low memory footprint
* @class LEvent
* @constructor
*/

var LEvent = {
	jQuery: false, //dispatch as jQuery events (enable this if you want to hook regular jQuery events to instances, they are dispatches as ":eventname" to avoid collisions)
	//map: new Weakmap(),

	/**
	* Binds an event to an instance
	* @method LEvent.bind
	* @param {Object} instance where to attach the event
	* @param {String} event_name string defining the event name
	* @param {function} callback function to call when the event is triggered
	* @param {Object} target_instance [Optional] instance to call the function (use this instead of .bind method to help removing events)
	**/
	bind: function( instance, event_name, callback, target_instance )
	{
		if(!instance) throw("cannot bind event to null");
		if(!callback) throw("cannot bind to null callback");
		if(instance.constructor === String ) throw("cannot bind event to a string");
		if(instance.hasOwnProperty("__on_" + event_name))
			instance["__on_" + event_name].push([callback,target_instance]);
		else
			instance["__on_" + event_name] = [[callback,target_instance]];
	},

	/**
	* Unbinds an event from an instance
	* @method LEvent.unbind
	* @param {Object} instance where the event is binded
	* @param {String} event_name string defining the event name
	* @param {function} callback function that was binded
	* @param {Object} target_instance [Optional] target_instance that was binded
	**/
	unbind: function( instance, event_name, callback, target_instance )
	{
		if(!instance) throw("cannot unbind event to null");
		if(!callback) throw("cannot unbind from null callback");
		if(instance.constructor === String ) throw("cannot bind event to a string");
		if(!instance.hasOwnProperty("__on_" + event_name)) return;

		for(var i in instance["__on_" + event_name])
		{
			var v = instance["__on_" + event_name][i];
			if(v[0] === callback && v[1] === target_instance)
			{
				instance["__on_" + event_name].splice( i, 1);
				break;
			}
		}

		if (instance["__on_" + event_name].length == 0)
			delete instance["__on_" + event_name];
	},

	/**
	* Unbinds all events from an instance (or the ones that match certain target_instance)
	* @method LEvent.unbindAll
	* @param {Object} instance where the events are binded
	* @param {Object} target_instance [Optional] target_instance of the events to remove
	**/
	unbindAll: function(instance, target_instance)
	{
		if(!instance) throw("cannot unbind events in null");
		if(!target_instance) //remove all
		{
			//two passes, to avoid deleting and reading at the same time
			var to_remove = [];
			for(var i in instance)
			{
				if(i.substring(0,5) != "__on_") 
					continue;//skip non-LEvent properties
				to_remove.push(i);
			}
			for(var i in to_remove)
				delete instance[remove[i]];
			return;
		}

		//remove only the target_instance
		//for every property in the instance
		for(var i in instance)
		{
			if(i.substring(0,5) != "__on_") 
				continue; //skip non-LEvent properties
			var array = instance[i];
			for(var j=0; j < array.length; ++j)
			{
				if( array[j][1] != target_instance ) 
					continue;
				array.splice(j,1);//remove
				--j;//iterate from the gap
			}

			if(array.length == 0)
				delete instance[i];
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
	isBind: function( instance, event_name, callback, target_instance )
	{
		if(!instance || !instance.hasOwnProperty("__on_" + event_name)) return false;
		for(var i in instance["__on_" + event_name])
		{
			var v = instance["__on_" + event_name][i];
			if(v[0] === callback && v[1] === target_instance)
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
	* @param {boolean} skip_jquery [optional] force to skip jquery triggering
	**/
	trigger: function( instance, event_type, params, skip_jquery )
	{
		if(!instance) throw("cannot trigger event from null");
		if(instance.constructor === String ) throw("cannot bind event to a string");

		//if(typeof(event) == "string")
		//	event = { type: event, target: instance, stopPropagation: LEvent._stopPropagation };
		//var event_type = event.type;

		//you can resend the events as jQuery events, but to avoid collisions with system events, we use ":" at the begining
		if(LEvent.jQuery && !skip_jquery) $(instance).trigger( ":" + event_type, params );

		if(!instance.hasOwnProperty("__on_" + event_type)) return;
		for(var i in instance["__on_" + event_type])
		{
			var v = instance["__on_" + event_type][i];
			if( v[0].call(v[1], event_type, params) == false)// || event.stop)
				break; //stopPropagation
		}

		return event;
	},

	//_stopPropagation: function() { this.stop = true; }
};