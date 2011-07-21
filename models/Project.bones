// Project
// -------
// Model. A single TileMill map project. Describes an MML JSON map object that
// can be used by `carto` to render a map.
model = Backbone.Model.extend({
    schema: {
        'type': 'object',
        'properties': {
            // Mapnik-specific properties.
            'srs': {
                'type': 'string',
                'required': true
            },
            'Stylesheet': {
                'type': ['object', 'array'],
                'required': true
            },
            'Layer': {
                'type': ['object', 'array'],
                'required': true
            },

            // TileMill-specific properties. @TODO these need a home, see
            // https://github.com/mapbox/tilelive-mapnik/issues/4
            'format': {
                'type': 'string',
                'enum': ['png', 'png24', 'png8', 'jpeg80', 'jpeg85', 'jpeg90', 'jpeg95']
            },
            'interactivity': {
                'type': ['object', 'boolean']
            },

            // TileJSON properties.
            'name':        { 'type': 'string' },
            'description': { 'type': 'string' },
            'version':     { 'type': 'string' },
            'attribution': { 'type': 'string' },
            'legend':      { 'type': 'string' },
            'minzoom': {
                'minimum': 0,
                'maximum': 22,
                'type': 'integer'
            },
            'maxzoom': {
                'minimum': 0,
                'maximum': 22,
                'type': 'integer'
            },
            'bounds': {
                'type': 'array',
                'items': { 'type': 'number' }
            },
            'center': {
                'type': 'array',
                'items': { 'type': 'number' }
            },

            // Non-stored properties.
            // @TODO make this writable at some point
            'scheme': {
                'type': 'string',
                'ignore': true
            },
            // @TODO make this writable at some point
            'formatter': {
                'type': 'string',
                'ignore': true
            },
            'tilejson': {
                'type': 'string',
                'ignore': true
            },
            'tiles': {
                'type': 'array',
                'required': true,
                'items': { 'type': 'string' },
                'ignore': true
            },
            'grids': {
                'type': 'array',
                'items': { 'type': 'string' },
                'ignore': true
            },
            '_updated': {
                'type': 'integer',
                'description': 'Last update time of project',
                'ignore': true
            },
            'id': {
                'type': 'string',
                'required': true,
                'pattern': '^[A-Za-z0-9\-_]+$',
                'title': 'Name',
                'description': 'Name may include alphanumeric characters, dashes and underscores.',
                'ignore': true
            }
        }
    },
    STYLESHEET_DEFAULT: [{
        id: 'style.mss',
        data: 'Map {\n'
            + '  background-color: #fff;\n'
            + '}\n\n'
            + '#world {\n'
            + '  polygon-fill: #eee;\n'
            + '  line-color: #ccc;\n'
            + '  line-width: 0.5;\n'
            + '}'
    }],
    LAYER_DEFAULT: [{
        id: 'world',
        name: 'world',
        srs: '+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 '
        + '+lon_0=0.0 +x_0=0.0 +y_0=0 +k=1.0 +units=m +nadgrids=@null +no_defs +over',
        geometry: 'polygon',
        Datasource: {
            file: 'http://tilemill-data.s3.amazonaws.com/world_borders_merc.zip',
            type: 'shape'
        }
    }],
    defaults: {
        'bounds': [-180,-90,180,90],
        'center': [0,0,2],
        'format': 'png',
        'interactivity': false,
        'minzoom': 0,
        'maxzoom': 22,
        'srs': '+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 '
            + '+lon_0=0.0 +x_0=0.0 +y_0=0 +k=1.0 +units=m +nadgrids=@null +no_defs +over',
        'Stylesheet': [],
        'Layer': []
    },
    // Custom setDefaults() method for creating a project with default layers,
    // stylesheets, etc. Note that we do not use Backbone native initialize()
    // or defaults(), both of which make default values far pervasive than the
    // expected use here.
    setDefaults: function() {
        var template = {};
        !this.get('Stylesheet').length && (template.Stylesheet = this.STYLESHEET_DEFAULT);
        !this.get('Layer').length && (template.Layer = this.LAYER_DEFAULT);
        this.set(this.parse(template), { silent: true });
    },
    // Instantiate collections from arrays.
    parse: function(resp) {
        resp.Stylesheet && (resp.Stylesheet = new models.Stylesheets(
            resp.Stylesheet,
            {parent: this}
        ));
        resp.Layer && (resp.Layer = new models.Layers(
            resp.Layer,
            {parent: this}
        ));
        return resp;
    },
    url: function() {
        return 'api/Project/' + this.id;
    },
    // Adds id uniqueness checking to validate.
    validate: function(attr) {
        if (attr.id &&
            this.collection &&
            this.collection.get(attr.id) &&
            this.collection.get(attr.id) !== this)
                return new Error(_('Project "<%=id%>" already exists.').template(attr));
        return this.validateAttributes(attr);
    },
    // Custom validation method that allows for asynchronous processing.
    // Expects options.success and options.error callbacks to be consistent
    // with other Backbone methods.
    validateAsync: function(attributes, options) {
        // If client-side, pass-through.
        if (!Bones.server) return options.success(this, null);

        var carto = require('carto'),
        // var carto = require('tilelive-mapnik/node_modules/carto'),
            mapnik = require('tilelive-mapnik/node_modules/mapnik'),
            stylesheets = this.get('Stylesheet'),
            env = {
                returnErrors: true,
                errors: [],
                validation_data: {
                    fonts: mapnik.fonts()
                },
                deferred_externals: [],
                only_validate: true,
                effects: []
            };

        // Hard clone the model JSON before rendering as rendering will change
        // properties (e.g. localize a datasource URL to the filesystem).
        var data = JSON.parse(JSON.stringify(attributes));
        new carto.Renderer(env).render(data, _(function(err, output) {
            // Carto parse error. Turn array into usable string as Bones error
            // convention is to use strings / wrapped string objects. This
            // string is easily parsed by the `Project` view for highlighting
            // syntax errors in code.
            //
            //     [{ line: 5, filename: 'style.mss', message: 'Foo bar'}] =>
            //     'style.mss:5 Foo bar'
            //
            // @TODO: Possibly make a change upstream in Carto for a better
            // error object with a good .toString() method?
            if (_(err).isArray()) {
                if (_(err).any(function(e) { return e.line && e.filename })) {
                    err = _(err).chain()
                        .filter(function(e) { return e.line && e.filename })
                        .map(function(e) {
                            return e.filename + ':' + e.line + ' ' + e.message
                        }).value().join('\n');
                } else {
                    err = err[0].message;
                }
                options.error(this, err);
            } else if (err) {
                options.error(this, err);
            } else {
                options.success(this, null);
            }
        }).bind(this));
    },
    // Single tile thumbnail URL generation. From [OSM wiki][1].
    // [1]: http://wiki.openstreetmap.org/wiki/Slippy_map_tilenames#lon.2Flat_to_tile_numbers_2
    thumb: function() {
        var z = this.get('center')[2];
        var lat_rad = this.get('center')[1] * Math.PI / 180 * -1; // -1 for TMS (flipped from OSM)
        var x = parseInt((this.get('center')[0] + 180.0) / 360.0 * Math.pow(2, z));
        var y = parseInt((1.0 - Math.log(Math.tan(lat_rad) + (1 / Math.cos(lat_rad))) / Math.PI) / 2.0 * Math.pow(2, z));
        return this.get('tiles')[0]
            .replace('{z}', z)
            .replace('{x}', x)
            .replace('{y}', y);
('_updated');
    },
    // Wrap `save` to call validateAsync first.
    save: _(Backbone.Model.prototype.save).wrap(function(parent, attrs, options) {
        this.validateAsync(attrs, {
            success: _(function() {
                parent.call(this, attrs, options);
            }).bind(this),
            error: options.error
        });
    }),
    // Hit the project poll endpoint.
    poll: function() {
        if (Bones.server) throw Error('Client-side method only.');
        $.ajax({
            url: this.url() + '/' + this.get('_updated'),
            type: 'GET',
            contentType: 'application/json',
            processData: false,
            success: _(function(resp) {
                if (!_(resp).keys().length) return;
                if (!this.set(this.parse(resp))) return;
                this.trigger('poll', this, resp);
            }).bind(this)
        });
    }
})
