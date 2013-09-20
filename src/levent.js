/* Lite Events system (similar to jQuery) but lightweight, to use to hook rendering stages */
var LEvent = {
	jQuery: false, //dispatch as jQuery events (enable this if you want to hook regular jQuery events to SceneGraph elements)

	bind: function( instance, event_name, callback, instance2 )
	{
		if(instance.constructor === String ) throw("cannot bind event to a string");
		if(instance.hasOwnProperty("__on_" + event_name))
			instance["__on_" + event_name].push([callback,instance2]);
		else
			instance["__on_" + event_name] = [[callback,instance2]];
	},

	unbind: function( instance, event_name, callback, instance2 )
	{
		if(instance.constructor === String ) throw("cannot bind event to a string");
		if(!instance || !instance.hasOwnProperty("__on_" + event_name)) return;

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
	},

	_stopPropagation: function() { this.stop = true; }
};