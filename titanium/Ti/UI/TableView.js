define(["Ti/_/declare", "Ti/_/UI/KineticScrollView", "Ti/_/style", "Ti/_/lang", "Ti/UI/MobileWeb/TableViewSeparatorStyle", "Ti/UI"], 
	function(declare, KineticScrollView, style, lang, TableViewSeparatorStyle, UI) {

	var setStyle = style.set,
		is = require.is,
		isDef = lang.isDef,
		regexpClickTap = /^(click|singletap)$/,

		// The amount of deceleration (in pixels/ms^2)
		deceleration = 0.001;

	return declare("Ti.UI.TableView", KineticScrollView, {

		constructor: function(args) {

			var scrollbarTimeout,
				contentContainer;
			this._initKineticScrollView(contentContainer = UI.createView({
				width: UI.INHERIT,
				height: UI.SIZE,
				left: 0,
				top: 0,
				layout: UI._LAYOUT_CONSTRAINING_VERTICAL
			}), "vertical", "vertical", 1);

			contentContainer._add(this._header = UI.createView({
				height: UI.SIZE, 
				width: UI.INHERIT, 
				layout: UI._LAYOUT_CONSTRAINING_VERTICAL
			}));
			contentContainer._add(this._sections = UI.createView({
				height: UI.SIZE, 
				width: UI.INHERIT, 
				layout: UI._LAYOUT_CONSTRAINING_VERTICAL
			}));
			contentContainer._add(this._footer = UI.createView({
				height: UI.SIZE, 
				width: UI.INHERIT, 
				layout: UI._LAYOUT_CONSTRAINING_VERTICAL
			}));

			this.data = [];
			this.constants.__values__.sections = [];
		},

		_handleMouseWheel: function() {
			this._fireScrollEvent("scroll");
		},

		_handleDragStart: function(e) {
			this.fireEvent("dragstart");
		},

		_handleDrag: function(e) {
			this._fireScrollEvent("scroll", e);
		},

		_handleDragEnd: function(e, velocityX, velocityY) {
			var self = this,
				y = -self._currentTranslationY;
			if (isDef(velocityY)) {
				var distance = velocityY * velocityY / (1.724 * deceleration) * (velocityY < 0 ? -1 : 1),
					duration = Math.abs(velocityY) / deceleration,
					translation = Math.min(0, Math.max(self._minTranslationY, self._currentTranslationY + distance));
				self.fireEvent("dragend",{
					decelerate: true
				});
				self._animateToPosition(self._currentTranslationX, translation, duration, UI.ANIMATION_CURVE_EASE_OUT, function() {
					self._setTranslation(self._currentTranslationX, translation);
					self._endScrollBars();
					self._fireScrollEvent("scrollend", e);
				});
			}
			
		},

		_fireScrollEvent: function(type, e) {
			// Calculate the visible items
			var firstVisibleItem,
				visibleItemCount = 0,
				contentContainer = this._contentContainer,
				y = -this._currentTranslationY,
				sections = this._sections,
				sectionsList = sections._children,
				len = sectionsList.length;
			for(var i = 0; i < len; i+= 1) {

				// Check if the section is visible
				var section = sectionsList[i],
					sectionOffsetTop = y - section._measuredTop,
					sectionOffsetBottom = section._measuredHeight - sectionOffsetTop;
				if (sectionOffsetTop > 0 && sectionOffsetBottom > 0) {
					var rows = section._rows._children
					for (var j = 1; j < rows.length; j += 1) {
						var row = rows[j],
							rowOffsetTop = sectionOffsetTop - row._measuredTop,
							rowOffsetBottom = row._measuredHeight - rowOffsetTop;
						if (rowOffsetTop > 0 && rowOffsetBottom > 0) {
							visibleItemCount++;
							!firstVisibleItem && (firstVisibleItem = row);
						}
					}
				}
			}

			// Create the scroll event
			this.fireEvent(type, {
				contentOffset: {
					x: 0,
					y: y
				},
				contentSize: {
					width: sections._measuredWidth,
					height: sections._measuredHeight
				},
				firstVisibleItem: firstVisibleItem,
				size: {
					width: contentContainer._measuredWidth,
					height: contentContainer._measuredHeight
				},
				totalItemCount: this.data.length,
				visibleItemCount: visibleItemCount,
				x: e && e.x,
				y: e && e.y
			});
		},

		_defaultWidth: UI.FILL,

		_defaultHeight: UI.FILL,
		
		_getContentOffset: function(){
			return {
				x: -this._currentTranslationX,
				y: -this._currentTranslationY
			};
		},
		
		_handleTouchEvent: function(type, e) {
			var i = 0,
				index = 0,
				localIndex,
				sections = this._sections._children,
				row = this._tableViewRowClicked,
				section = this._tableViewSectionClicked;
			if (type === "click" || type === "singletap" || type === "longpress") {
				if (row && section) {
					
					//TODO write tests
					for (; i < sections.length; i += 2) {
						localIndex = sections[i]._rows._children.indexOf(row);
						if (localIndex !== -1) {
							//TODO write tests
							index += Math.floor(localIndex / 2);
							break;
						} else {
							index += sections[i].rowCount;
						}
					}
					e.row = e.rowData = row;
					e.index = index;
					e.section = section;
					e.searchMode = false; 
	
					KineticScrollView.prototype._handleTouchEvent.apply(this, arguments);
	
					this._tableViewRowClicked = null;
					this._tableViewSectionClicked = null;
				}
			} else {
				KineticScrollView.prototype._handleTouchEvent.apply(this, arguments);
			}
		},

		_createSeparator: function() {
			var separator = UI.createView({
				height: 1,
				width: UI.INHERIT,
				backgroundColor: "white"
			});
			setStyle(separator.domNode,"minWidth","100%"); // Temporary hack until TIMOB-8124 is completed.
			return separator;
		},
		
		_createDecorationLabel: function(text) {
			return UI.createLabel({
				text: text, 
				backgroundColor: "darkGrey",
				color: "white",
				width: UI.INHERIT,
				height: UI.SIZE,
				left: 0,
				font: {fontSize: 22}
			});
		},
		
		_refreshSections: function() {
			for (var i = 0; i < this._sections._children.length; i += 1) {
				this._sections._children[i]._refreshRows();
			}
			this._triggerLayout();
		},
		// Total Row Count in the Table
		rowCount:function(){
			var currentOffset = 0;
			for(var i = 0; i < this._sections._children.length; i++) {
				section = this._sections._children[i];
				currentOffset += section.rowCount;			
			}		
			return currentOffset;	
		},
		
		_calculateLocation: function(index, insertAfter) {
			var currentOffset = 0,
				section;
			
			for(var i = 0; i < this._sections._children.length; i++) {
				section = this._sections._children[i];
				currentOffset += section.rowCount;
				
				if (insertAfter) {
					if (index <= currentOffset) {
						return {
							section: section,
							localIndex: section.rowCount - (currentOffset - index)
						};
					}
				} else {
					if (index < currentOffset) {
						return {
							section: section,
							localIndex: section.rowCount - (currentOffset - index)
						};
					}
				}
			}
			
			// Handle the special case of inserting after the last element in the last section
			if (index == currentOffset) {
				return {
					section: section,
					localIndex: section.rowCount
				};
			}
		},
		
		_insertRow: function(value, index, insertAfter) {
			var location = this._calculateLocation(index, insertAfter);
			
			if (location) {
				location.section.add(value, location.localIndex); // We call the normal .add() method to hook into the sections proper add mechanism
			}
			this._publish(value);
			this._refreshSections();
		},
		
		_removeRow: function(index) {
			var location = this._calculateLocation(index);
			if (location) {
				this._unpublish(location.section._rows._children[location.localIndex]);
				location.section._removeAt(location.localIndex);
			}
		},

		appendRow: function(value) {
			if (!this._currentSection) {
				this._sections._add(this._currentSection = UI.createTableViewSection({_tableView: this}));
				this.sections.push(this._currentSection);
				this._sections._add(this._createSeparator());
				this.data.push(this._currentSection);
			}
			this._currentSection.add(value); // We call the normal .add() method to hook into the sections proper add mechanism
			this._publish(value);
			this._refreshSections();
		},

		deleteRow: function(index) {
			this._removeRow(index);
		},

		insertRowAfter: function(index, value) {
			this._insertRow(value, index + 1, true);
		},

		insertRowBefore: function(index, value) {
			this._insertRow(value, index);
		},

		updateRow: function(index, row) {
			this._removeRow(index);
			this._insertRow(row, index);
		},

		scrollToIndex: function(index) {
			var location = this._calculateLocation(index);
			location && this._setTranslation(0,-location.section._measuredTop -
				location.section._rows._children[ location.localIndex + 1]._measuredTop);
		},
		
		scrollToTop: function(top) {
			this._setTranslation(0,-top);
		},
		
		_insertSection: function(sections, index) {
			!is(sections,"Array") && (sections = [sections]);
			var i = 0,
				len = sections.length;
			for(; i < len; i++) {
				if (!isDef(sections[i].declaredClass) || sections[i].declaredClass != "Ti.UI.TableViewSection") {
					sections[i] = UI.createTableViewSection(sections[i]);
				}
				this._sections._insertAt(sections[i], index + i);
				if (index === len) {
					this.sections.push(sections[i]);
				} else {
					this.sections.splice(index,0,sections[i]);
				}
			}
			this._refreshSections();
		},
		
		_removeSection: function(index) {
			this._sections._remove(this.sections[index]);
			this.sections.splice(index,1);
		},
		
		appendSection: function(section) {
			this._insertSection(section, this.sections.length);
		},
		
		deleteSection: function(section) {
			if (section in this.sections) {
				this._sections._remove(this.sections[section]);
				this.sections.splice(section,1);
			}
		},
		
		insertSectionBefore: function(index, section) {
			this._insertSection(section, index);
		},
		
		insertSectionAfter: function(index, section) {
			this._insertSection(section, index + 1);
		},
		
		updateSection: function(index, section) {
			this._removeSection(index);
			this._insertSection(section, index);
		},
		
		getIndexByName: function(name) {
			var index = 0;
			
			for (var i = 0; i < this._sections._children.length; i++) {
				if (i > 0) {
					index += this._sections._children[i - 1].rows.length;
				}

				for (var j = 0; j < this._sections._children[i].rows.length; j++) {					
					if (this._sections._children[i].rows[j].name === name) {
						index += j;
						
						return index;		
					}
				}
			}
			
			return index;
		},
		
		constants: {
			sectionCount: {
				get: function() {
					return this.sections.length;
				}
			},			
			sections: void 0
		},
		
		properties: {		
			data: {
				set: function(value) {
					if (is(value,'Array')) {
						var retval = [];
						var tableData = [];
						
						this._sections._removeAllChildren();
						this.constants.__values__.sections = [];
						this._currentSection = void 0;
												
						for (var i in value) {
							if (!isDef(value[i].declaredClass) 
								|| (value[i].declaredClass != "Ti.UI.TableViewRow" && value[i].declaredClass != "Ti.UI.TableViewSection")
							) {
								value[i] = UI.createTableViewRow(value[i]);
							}

							if (value[i].declaredClass === "Ti.UI.TableViewRow") {
								if (i == 0) {
									section = UI.createTableViewSection({_tableView: this});
									
									if (typeof(value[i].header) != 'undefined') {
										section.headerTitle = value[i].header;
									}
									
									tableData[i] = section;
									section.add(value[i]);
								} else {
									if (typeof(value[i].header) != 'undefined') {
										section = UI.createTableViewSection({_tableView: this});
										section.headerTitle = value[i].header;
										
										tableData[tableData.length] = section;
										section.add(value[i]);
									} else {			
										tableData[tableData.length - 1].add(value[i]);
									}									
								}
							} else if (value[i].declaredClass === "Ti.UI.TableViewSection") {
								tableData[tableData.length] = value[i];
							}
						}						
					
						for (var i = 0; i < tableData.length; i++) {
							this.appendSection(this._currentSection = tableData[i]);
							this._publish(tableData[i]);
							
							retval.push(this._currentSection);							
						}
						
						this._refreshSections();
												
						return retval;
					} else {					
						return;
					}
				}
			},
			search: {
				set: function(searchBar) {

					searchBar.setWidth(UI.INHERIT);
					searchBar.setHeight(this.rowHeight);
					searchBar.setTop(0);

					var firstRow = this.getChildren()[0];
					if (firstRow === searchBar) {
						firstRow = this.getChildren()[1];
					}
					firstRow.setTop(this.rowHeight);

					searchBar.addEventListener('change', function(e) {
						for (var i = 0; i < this._sections._children.length; i++) {
							for (var j = 0; j < this._sections._children[i].rows.length; j++) {
								var child = this._sections._children[i].rows[j];
								if (child !== searchBar) {
									if (child.title && child.title.match(searchBar.value)) {
										child.setHeight(this.rowHeight);
									} else {
										child.setHeight(0);
									}
								}
							}
						};
					}.bind(this));
					this.add(searchBar);
				}

			},
			footerTitle: {
				set: function(value, oldValue) {
					if (oldValue != value) {
						this._footer._removeAllChildren();
						this._footer._add(this._createDecorationLabel(value));
					}
					return value;
				}
			},
			footerView: {
				set: function(value, oldValue) {
					if (oldValue != value) {
						this._footer._removeAllChildren();
						this._footer._add(value);
					}
					return value;
				}
			},
			headerTitle: {
				set: function(value, oldValue) {
					if (oldValue != value) {
						this._header._removeAllChildren();
						this._header._add(this._createDecorationLabel(value));
						this._header._add(this._createSeparator());
					}
					return value;
				}
			},
			headerView: {
				set: function(value, oldValue) {
					if (oldValue != value) {
						this._header._removeAllChildren();
						this._header._add(value);
					}
					return value;
				}
			},
			maxRowHeight: {
				post: "_refreshSections"
			},
			minRowHeight: {
				post: "_refreshSections"
			},
			rowHeight: {
				post: "_refreshSections",
				value: "50px"
			},
			
			separatorColor: {
				post: "_refreshSections",
				value: "lightGrey"
			},
			separatorStyle: {
				post: "_refreshSections",
				value: TableViewSeparatorStyle.SINGLE_LINE
			}
		}

	});

});