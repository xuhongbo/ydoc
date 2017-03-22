var fs = require('fs');
var sysPath = require('path');
var colors = require('colors');
var mkdirp = require('mkdirp');
var artTemplate = require('art-template');
var childProcess = require('child_process');
var marked = require('marked');
var glob = require('glob');
var JSON5 = require('json5');
var Prism = require('prismjs');

var parsers = require('../parsers');
var reJS = /^javascript|js$/i;
var parseAliases = function(lang) {
    if (reJS.test(lang)) {
        return 'javascript';
    }
    if (lang === 'html') {
        return 'markup';
    }
    return lang;
}

function setMarkedOptions(grammar) {
    grammar = parseAliases(grammar);

    if (typeof grammar === 'string') {
        try {
            require.resolve('prismjs/components/prism-' + grammar + '.js');
        } catch (e) {
            console.warn('! 无法解析默认语法 ' + grammar + '，未检测到语法的将不进行高亮'.blue);
        }
    }

    marked.setOptions({
        highlight: function(code, lang, callback) {
            lang = parseAliases(lang) || lang || grammar;
            if (!lang)
                return code;
            try {
                lang = lang.toLowerCase();
                require('prismjs/components/prism-' + lang + '.js');
                if (Prism.languages[lang]) {
                    return Prism.highlight(code, Prism.languages[lang])
                } else {
                    return code;
                }
            } catch (e) {
                // 找不到 prismjs 支持的语言就原样返回
                return code;
            }
        }
    });
}

artTemplate.config('escape', false);

artTemplate.helper('markdown', function(content) {
    return marked(content);
});

artTemplate.helper('anchor', function(name) {
    return name
        ? name.replace(/[\.\:\s\@\/]/g, '-')
        : '';
});

artTemplate.helper('txt', function(html) {
    return html
        ? html.replace(/\<\/?[^\>]*\>/g, '')
        : '';
});

function doParser(cwd, filePath, ignore, compile, options, conf, codeRender) {
    var extName = sysPath.extname(filePath),
        parser;
    if (compile) {
        parsers.some(function(p) {
            if (p.type == compile) {
                parser = p;
                return true;
            }
        });
    } else {
        parsers.some(function(p) {
            if (p.extNames.indexOf(extName) > -1) {
                parser = p;
                return true;
            }
        });
    }
    if (parser) {
        var files = glob.sync(filePath, {
                cwd: cwd,
                ignore: ignore || []
            }),
            options = Object.assign({
                files: files
            }, conf.options[parser.type] || {}, options || {});

        if (files.length) {
            var contents = files.map(function(fp) {
                var content = fs.readFileSync(sysPath.join(cwd, fp), 'UTF-8');
                if (options.source) {
                    var dp = sysPath.join(conf.dest, 'static', sysPath.dirname(fp));
                    mkdirp.sync(dp);

                    fs.writeFileSync(sysPath.join(dp, sysPath.basename(fp) + '.html'), codeRender({
                        title: conf.name + ' : ' + fp,
                        footer: conf.footer,
                        sourceDir: sysPath.relative(dp, sysPath.join(conf.dest, 'source')),
                        type: parser.highlight || parser.type,
                        content: content
                    }), 'UTF-8');

                    console.log(('√ 生成文件: ' + sysPath.join(dp, sysPath.basename(fp) + '.html')).yellow);

                }
                return content;
            });
            var ret = parser.parser(contents, options, conf);
            return ret;
        } else {
            console.log(('X ' + filePath + ' 未找到文件。').red);
        }
    } else {
        console.log(('X ' + extName + ' 未找到编译器。').red);
    }
    return {};
}

module.exports = function(cwd, conf) {
    conf.cwd = cwd;
    conf.options = conf.options || {};

    setMarkedOptions(conf.defaultGrammar);

    var render = artTemplate.compile(conf.templateContent);
    var codeRender = artTemplate.compile(conf.codeTemplateContent);
    var resources = conf.resources || {};
    if (conf.theme) {
        var theme = conf.theme,
            themeConfPath = sysPath.join(cwd, /^\w/.test(theme) ? 'node_modules/ydoc-theme-' + theme : theme, 'theme.config');
        try {
            var themeConf = JSON5.parse(fs.readFileSync(themeConfPath, 'utf-8'));
        } catch (e) {
            console.log(e);
        }
    }
    if (conf.pages) {
        conf.pages.forEach(function(page) {
            var data = {},
                common = conf.common || {};
            if (conf.options) {
                conf.options.foldcode && (data.foldcode = conf.options.foldcode);
                conf.options.foldparam && (data.foldparam = conf.options.foldparam);
                conf.options.foldsidenav && (data.foldsidenav = conf.options.foldsidenav);
                conf.options.staticsidenav && (data.staticsidenav = conf.options.staticsidenav);
                // 子页面 options
                if (page.options && page.options.foldsidenav) {
                    data.foldsidenav = page.options.foldsidenav;
                }
                if (page.options && page.options.staticsidenav) {
                    data.staticsidenav = page.options.staticsidenav;
                }
                // staticsidenav & foldsidenav 同时存在时禁用 foldsidenav
                if (data.staticsidenav && data.foldsidenav) {
                    data.foldsidenav = false;
                }
                if (conf.options.insertCSS) {
                    data.insertCSS = conf.options.insertCSS;
                }
                if (conf.options.insertJS) {
                    data.insertJS = conf.options.insertJS;
                }
                if (conf.options.hasPageName) {
                    data.hasPageName = conf.options.hasPageName;
                }
            }
            data.name = conf.name;
            data.title = common.title + ' ' + page.title;
            data.footer = common.footer;
            data.home = common.home;
            data.homeUrl = common.homeUrl;
            if (conf.theme) {
                var themeConfJS = themeConf.js;
                var themeConfCSS = themeConf.css;
                if (themeConfJS && themeConfJS.length) {
                    for (var i = 0; i < themeConfJS.length; i++) {
                        themeConfJS[i] = sysPath.join(themeConfJS[i]);
                        data.themeJS = themeConfJS;
                    }
                }
                if (themeConfCSS && themeConfCSS.length) {
                    for (var i = 0; i < themeConfCSS.length; i++) {
                        themeConfCSS[i] = sysPath.join(themeConfCSS[i]);
                    }
                    data.themeCSS = themeConfCSS;
                }
            }
            if (common.navbars) {
                data.navbars = common.navbars.map(function(item) {
                    return {
                        name: item.name,
                        url: item.url,
                        target: item.target || 'self',
                        active: item.name == conf.name
                    };
                });
            }
            data.tabs = conf.pages.map(function(item) {
                return {
                    name: item.name,
                    url: item.url,
                    title: item.title,
                    active: item.name == page.name
                }
            });
            data.banner = page.banner;
            if (page.intro) {
                var introPath = sysPath.join(cwd, page.intro);
                if (fs.existsSync(introPath)) {
                    data.intro = marked(fs.readFileSync(introPath, 'UTF-8'));
                }
            }
            if (page.content && (!conf.buildPages.length || conf.buildPages.indexOf(page.name) > -1)) {
                if (page.content.multi) {
                    var pName;
                    var navs = page.content.pages.map(function(p) {
                        if (!(p.sub)) {
                            pName = p.name;
                        }
                        return {
                            name: p.name,
                            pName: pName,
                            sub: !!p.sub,
                            blank: !p.content,
                            url: (p.index || (page.name + '-' + p.name)) + '.html'
                        };
                    });

                    page.content.pages.forEach(function(p, index) {
                        if (p.content) {
                            var curNavs = navs.slice(0);
                            data.article = doParser(cwd, p.content, p.ignore, p.compile, p.options, conf, codeRender);
                            if (data.article.menus) {
                                curNavs.splice.apply(curNavs, [
                                    index + 1,
                                    0
                                ].concat(data.article.menus.filter(function(item) {
                                    return !item.sub;
                                })).map(function(item) {
                                    item.sub = true;
                                    return item;
                                }));
                            }
                            data.article.sidebars = curNavs;

                            data.article.name = p.name;
                            curNavs.forEach(function(item) {
                                if (item.name == data.article.name) {
                                    data.article.parentName = item.pName;
                                }
                            });
                            data.pagename = page.name + '-' + p.name;
                            fs.writeFileSync(sysPath.join(conf.dest, (p.index || (page.name + '-' + p.name)) + '.html'), render(data));
                            console.log(('√ 生成文件: ' + sysPath.join(conf.dest, (p.index || (page.name + '-' + p.name)) + '.html')).yellow);
                        }
                    });
                    data.article = doParser(cwd, page.content.index, page.indexIngore, page.indexCompile, page.content.indexOptions, conf, codeRender);
                    data.article.sidebars = navs;
                } else if (typeof page.content == 'string') {
                    data.article = doParser(cwd, page.content, page.ignore, page.compile, page.options, conf, codeRender);
                    if (data.article.menus && data.article.menus.length && !data.article.sidebars) {
                        data.article.sidebars = data.article.menus;
                    }
                } else {
                    var navs = [],
                        blocks = [];
                    page.content.blocks.forEach(function(block) {
                        if (block.name) {
                            navs.push({
                                name: block.name,
                                index: block.index,
                                tag: "#" + block.name.replace(/[\.\:\s\@\/]/g, '-'),
                                sub: block.sub || false
                            });
                        }
                        if (typeof block.content == 'string') {
                            var ret = doParser(cwd, block.content, block.ignore, block.compile, block.options, conf, codeRender);
                            if (block.name && !block.sub && ret.menus) {
                                ret.menus.forEach(function(item) {
                                    if (!item.sub) {
                                        navs.push({
                                            name: item.name,
                                            tag: "#" + item.name.replace(/[\.\:\s\@\/]/g, '-'),
                                            sub: true
                                        });
                                    }
                                });
                            }
                            ret.name = block.name;
                            ret.tag = block.name.replace(/[\.\:\s\@\/]/g, '-');
                            ret.sub = block.sub || false;
                            blocks.push(ret);
                        } else {
                            blocks.push({
                                type: 'html',
                                name: block.name,
                                index: block.index,
                                tag: block.name.replace(/[\.\:\s\@\/]/g, '-'),
                                sub: false,
                                content: ''
                            });
                        }
                    });
                    data.article = {
                        type: 'block'
                    };
                    if (page.content.sidebar) {
                        data.article.sidebars = navs;
                    }

                    data.article.blocks = blocks;
                }
                data.pagename = page.name;
                fs.writeFileSync(sysPath.join(conf.dest, page.name + '.html'), render(data));
                console.log(('√ 生成文件: ' + sysPath.join(conf.dest, page.name + '.html')).yellow);
            }
        });
    }

    for (var key in resources) {
        try {
            childProcess.execSync('cp -r ' + sysPath.join(cwd, resources[key]) + ' ' + sysPath.join(conf.dest, key));
        } catch (e) {
            console.log(('X 资源 ' + key + ' 复制失败').red);
            console.log(e.toString().red);
        }
    }

    // 复制theme文件夹下的文件到_docs/theme
    if (conf.theme) {
        try {
            childProcess.execSync('cp -r ' + sysPath.join(cwd, 'node_modules/ydoc-theme-' + theme) + ' ' + sysPath.join(conf.dest, 'theme'));
        } catch (e) {
            console.log(('X 资源 ' + sysPath.join(cwd, theme) + ' 复制失败').red);
            console.log(e.toString().red);
        }
    }
};

module.exports.usage = '构建文档';

module.exports.setOptions = function(optimist) {
    optimist.alias('t', 'template');
    optimist.describe('t', '模板路径');
    optimist.alias('p', 'page');
    optimist.describe('p', '选择生成的页面，默认生成所有');
    optimist.alias('w', 'watch');
    optimist.describe('w', '监控文件更改，自动编译');
    optimist.alias('o', 'output');
    optimist.describe('o', '指定输出目录');
};
