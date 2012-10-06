'use strict';

module.exports = function(grunt) {

  // Project configuration.
  grunt.initConfig({
    pkg: '<json:package.json>',
    lint: {
      files: [ 'grunt.js', 'styledocco.js', 'cli.js', 'bin/*', 'share/*.js',
               'test/**/*.js' ]
    },
    min: {
      dist: {
        src: [ 'lib/docs.js' ],
        dest: 'lib/docs.js'
      }
    },
    mincss: {
      dist: {
        files: {
          'lib/docs.css': 'lib/docs.css'
        }
      }
    },
    copy: {
      dist: {
        files: {
          lib: [ 'share/*.jade', 'share/*.css' ]
        }
      }
    },
    browserify: {
      "lib/docs.js": {
        entries: [ 'share/docs.previews.js', 'share/docs.ui.js' ]
      }
    },
    watch: {
      files: [ '<config:lint.files>', 'share/*', 'examples/**' ],
      // tasks: 'lint min cssmin copy'
      tasks: 'default'
    },
    jshint: {
      options: {
        strict: true,
        browser: true,
        node: true,
        eqnull: true,
        globalstrict: true
      },
      globals: {
        styledocco: true,
        buster: true, assert: true, refute: true, test: true
      }
    },
    shell: {
      generate_styles: {
        command: "node bin/styledocco ./examples/bootstrap",
        stdout: true
      }
    }
  });

  // Default task.
  grunt.registerTask('default', 'browserify min mincss copy shell');
  grunt.registerTask('dev', 'browserify copy');

  grunt.loadNpmTasks("grunt-contrib");
  grunt.loadNpmTasks('grunt-browserify');
  grunt.loadNpmTasks('grunt-shell');
};
