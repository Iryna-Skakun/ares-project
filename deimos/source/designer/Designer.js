/* global ProjectKindsModel, ares */
enyo.kind({
	name: "Designer",
	published: {
		designerFrameReady: false,
		currentKind: null,
		height: null,
		width: null,
		currentFileName: ""
	},
	events: {
		onDesignRendered: "",
		onSelect: "",
		onSelected: "",
		onCreateItem: "",
		onMoveItem: "",
		onSyncDropTargetHighlighting: "",
		onReloadComplete: "",
		onResizeItem: "",
		onError: "",
		onReturnPositionValue: "",
		onForceCloseDesigner: ""
	},
	components: [
		{name: "client", tag: "iframe", classes: "ares-designer-frame-client"},
		{name: "communicator", kind: "RPCCommunicator", onMessage: "receiveMessage"}
	],
	baseSource: "designerFrame.html",
	projectSource: null,
	selection: null,
	reloadNeeded: false,
	scale: 1,
	reloading: false,
	debug: false,
	create: function() {
		ares.setupTraceLogger(this);
		this.inherited(arguments);
	},
	rendered: function() {
		this.inherited(arguments);
		this.$.communicator.setRemote(this.$.client.hasNode().contentWindow);
	},
	currentKindChanged: function() {
		this.trace("reloadNeeded", this.reloadNeeded);
		if (this.reloadNeeded) {
			this.reloadNeeded = false;
			this.reload();
		} else {
			this.renderCurrentKind();
		}
	},
	heightChanged: function() {
		this.$.client.applyStyle("height", this.getHeight()+"px");
		this.resizeClient();
		this.repositionClient();
	},
	widthChanged: function() {
		this.$.client.applyStyle("width", this.getWidth()+"px");
		this.resizeClient();
		this.repositionClient();
	},
	zoom: function(inScale) {
		this.scale = (inScale >= 0) ? Math.max(inScale / 100, 0.2) : 1;
		enyo.dom.transformValue(this.$.client, "scale", this.scale);
		this.$.client.resized();
		this.repositionClient();
	},
	repositionClient: function() {
		var height = this.getHeight(),
			width = this.getWidth(),
			scaledHeight = height * this.scale,
			scaledWidth =  width  * this.scale,
			y = -1*(height - scaledHeight)/2,
			x = -1*(width  - scaledWidth)/2;
		
		this.$.client.addStyles("top: " + y + "px; left: " + x + "px");
	},
	
	updateSource: function(inSource) {
		var serviceConfig = inSource.getService().config;
		this.setDesignerFrameReady(false);
		this.projectSource = inSource;
		this.projectPath = serviceConfig.origin + serviceConfig.pathname + "/file";
		var iframeUrl = this.projectSource.getProjectUrl() + "/" + this.baseSource + "?overlay=designer";
		this.trace("Setting designerFrame url: ", iframeUrl);
		this.$.client.hasNode().src = iframeUrl;
	},
	reload: function() {
		this.reloading = true;
		this.updateSource(this.projectSource);
	},
	
	//* Send message via communicator
	sendMessage: function(inMessage) {
		this.trace("Op: ", inMessage.op, inMessage);
		this.$.communicator.sendMessage(inMessage);
	},
	//* Respond to message from communicator
	receiveMessage: function(inSender, inEvent) {
		
		var msg = inEvent.message;

		this.trace("Op: ", msg.op, msg);

		if(!msg || !msg.op) {
			enyo.warn("Deimos designer received invalid message data:", msg);
			return;
		}
		
		// designerFrame is initialized and ready to do work.
		if(msg.op === "state" && msg.val === "initialized") {
			this.sendDesignerFrameContainerData();
		// designerFrame received container data
		} else if(msg.op === "state" && msg.val === "ready") {
			this.setDesignerFrameReady(true);
			if(this.reloading) {
				this.doReloadComplete();
				this.reloading = false;
			}
		// Loaded event sent from designerFrame and awaiting aresOptions.
		} else if(msg.op === "state" && msg.val === "loaded") {
			this.designerFrameLoaded();
		// The current kind was successfully rendered in the iframe
		} else if(msg.op === "rendered") {
			// FIXME: ENYO-3181: synchronize rendering for the right rendered file
			this.kindRendered(msg.val, msg.filename);
		// Select event sent from here was completed successfully. Set _this.selection_.
		} else if(msg.op === "selected") {
			this.selection = enyo.json.codify.from(msg.val);
			this.doSelected({component: this.selection});
		// New select event triggered in designerFrame. Set _this.selection_ and bubble.
		} else if(msg.op === "select") {
			this.selection = enyo.json.codify.from(msg.val);
			this.doSelect({component: this.selection});
		// Highlight drop target to minic what's happening in designerFrame
		} else if(msg.op === "syncDropTargetHighlighting") {
			this.doSyncDropTargetHighlighting({component: enyo.json.codify.from(msg.val)});
		// New component dropped in designerFrame
		} else if(msg.op === "createItem") {
			this.doCreateItem(msg.val);
		// Existing component dropped in designerFrame
		} else if(msg.op === "moveItem") {
			this.doMoveItem(msg.val);
		} else if (msg.op === "reloadNeeded") {
			this.reloadNeeded = true;
		} else if(msg.op === "error") {
			if (( ! msg.val.hasOwnProperty('popup')) || msg.val.popup === true) {
				if (msg.val.requestReload === true) {
					msg.val.callback = this.goBacktoEditor.bind(this);
					msg.val.action = "Switching back to code editor";
				}
				this.doError(msg.val);
			} else {
				// TODO: We should store the error into a kind of rotating error log - ENYO-2462
			}
		// Existing component resized
		} else if(msg.op === "resize") {
			this.doResizeItem(msg.val);
		// Returning requested position value
		} else if(msg.op === "returnPositionValue") {
			this.doReturnPositionValue(msg.val);
		// Default case
		} else {
			enyo.warn("Deimos designer received unknown message op:", msg);
		}
	},
	goBacktoEditor: function() {
		this.doForceCloseDesigner();
	},
	//* Pass _isContainer_ info down to designerFrame
	sendDesignerFrameContainerData: function() {
		this.sendMessage({op: "containerData", val: ProjectKindsModel.getFlattenedContainerInfo()});
	},
	//* Tell designerFrame to render the current kind
	renderCurrentKind: function(inSelectId) {
		if(!this.getDesignerFrameReady()) {
			return;
		}
		
		var currentKind = this.getCurrentKind();
		var components = [currentKind];
		// FIXME: ENYO-3181: synchronize rendering for the right rendered file
		this.sendMessage({op: "render", filename: this.currentFileName, val: {name: currentKind.name, components: enyo.json.codify.to(currentKind.components), componentKinds: enyo.json.codify.to(components), selectId: inSelectId}});
	},
	select: function(inControl) {
		this.sendMessage({op: "select", val: inControl});
	},
	highlightDropTarget: function(inControl) {
		this.sendMessage({op: "highlight", val: inControl});
	},
	unHighlightDropTargets: function() {
		this.sendMessage({op: "unhighlight"});
	},
	//* Property was modified in Inspector, update designerFrame.
	modifyProperty: function(inProperty, inValue) {
		// FIXME: ENYO-3181: synchronize rendering for the right rendered file
		this.sendMessage({op: "modify", filename: this.currentFileName, val: {property: inProperty, value: inValue}});
	},
	//* Send message to Deimos with components from designerFrame
	kindRendered: function(content, filename) {
		// FIXME: ENYO-3181: synchronize rendering for the right rendered file
		this.doDesignRendered({content: content, filename: filename});
	},
	//* Initialize the designerFrame depending on aresOptions
	designerFrameLoaded: function() {
		// FIXME: ENYO-3433 : options are hard-coded with
		// defaultKindOptions that are currently known. the whole/real
		// set must be determined indeed.
		this.sendMessage({op: "initializeOptions", options: ProjectKindsModel.get("defaultKindOptions")});
	},
	//* Clean up the designerFrame before closing designer
	cleanUp: function() {
		this.sendMessage({op: "cleanUp"});
	},
	//* Pass inCode down to the designerFrame (to avoid needing to reload the iFrame)
	syncJSFile: function(inCode) {
		this.sendMessage({op: "codeUpdate", val: inCode});
	},
	//* Sync the CSS in inCode with the designerFrame (to avoid needing to reload the iFrame)
	syncCSSFile: function(inFilename, inCode) {
		this.sendMessage({op: "cssUpdate", val: {filename: this.projectPath + inFilename, code: inCode}});
	},
	resizeClient: function() {
		this.sendMessage({op: "resize"});
	},
	//* Prerender simulated drop in designerFrame
	prerenderDrop: function(inTargetId, inBeforeId) {
		this.sendMessage({op: "prerenderDrop", val: {targetId: inTargetId, beforeId: inBeforeId}});
	},
	//* Request auto-generated position value from designerFrame
	requestPositionValue: function(inProp) {
		this.sendMessage({op: "requestPositionValue", val: inProp});
	},
	sendSerializerOptions: function(serializerOptions) {
		this.sendMessage({op: "serializerOptions", val: serializerOptions});	
	},
	sendDragType: function(type) {
		this.sendMessage({op: "dragStart", val: type});
	}
});
