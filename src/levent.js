/* Lite Events system (similar to jQuery) but lightweight, to use to hook rendering stages */
var LEvent = {
	jQuery: false, //dispatch as jQuery events (enable this if you want to hook regular jQuery events to instances, they are dispatches as ":eventname" to avoid collisions)
	//map: new Weakmap(),

	bind: function( instance, event_name, callback, instance2 )
	{
		if(!instance) throw("cannot bind event to null");
		if(!callback) throw("cannot bind to null callback");
		if(instance.constructor === String ) throw("cannot bind event to a string");
		if(instance.hasOwnProperty("__on_" + event_name))
			instance["__on_" + event_name].push([callback,instance2]);
		else
			instance["__on_" + event_name] = [[callback,instance2]];
	},

	unbind: function( instance, event_name, callback, instance2 )
	{
		if(!instance) throw("cannot unbind event to null");
		if(!callback) throw("cannot unbind from null callback");
		if(instance.constructor === String ) throw("cannot bind event to a string");
		if(!instance.hasOwnProperty("__on_" + event_name)) return;

		for(var i in instance["__on_" + event_name])
		{
			var v = instance["__on_" + event_name][i];
			if(v[0] === callback && v[1] === instance2)
			{
				instance["__on_" + event_name].splice( i, 1);
				break;
			}
		}

		if (instance["__on_" + event_name].length == 0)
			delete instance["__on_" + event_name];
	},

	unbindAll: function(instance, instance2)
	{
		if(!instance) throw("cannot unbind event to null");
		if(!instance2) //remove all
		{
			var remove = [];
			for(var i in instance)
			{
				if(i.substring(0,5) != "__on_") continue;
				remove.push(i);
			}
			for(var i in remove)
				delete instance[remove[i]];
			return;
		}

		//remove only the instance2
		//for every property in the instance
		for(var i in instance)
		{
			if(i.substring(0,5) != "__on_") continue; //skip non-LEvent properties
			var array = instance[i];
			for(var j=0; j < array.length; ++j)
			{
				if( array[j][1] != instance2 ) continue;
				array.splice(j,1);//remove
				--j;//iterate from the gap
			}
			if(array.length == 0)
				delete instance[i];
		}
	},

	isbind: function( instance, event_name, callback, instance2 )
	{
		if(!instance || !instance.hasOwnProperty("__on_" + event_name)) return false;
		for(var i in instance["__on_" + event_name])
		{
			var v = instance["__on_" + event_name][i];
			if(v[0] === callback && v[1] === instance2)
				return true;
		}
		return false;
	},

	trigger: function( instance, event, params, skip_jquery )
	{
		if(!instance) throw("cannot trigger event from null");
		if(instance.constructor === String ) throw("cannot bind event to a string");
		//you can resend the events as jQuery events, but to avoid collisions with system events, we use ":" at the begining
		if(typeof(event) == "string")
			event = { type: event, target: instance, stopPropagation: LEvent._stopPropagation };

		if(LEvent.jQuery && !skip_jquery) $(instance).trigger( ":" + event.type, params );

		if(!instance.hasOwnProperty("__on_" + event.type)) return;
		for(var i in instance["__on_" + event.type])
		{
			var v = instance["__on_" + event.type][i];
			if( v[0].call(v[1], event, params) == false || event.stop)
				break; //stopPropagation
		}

		return event;
	},

	_stopPropagation: function() { this.stop = true; }
};