(function(i){i.languages.diff={coord:[/^(?:\*{3}|-{3}|\+{3}).*$/m,/^@@.*@@$/m,/^\d.*$/m]};var r={"deleted-sign":"-","deleted-arrow":"<","inserted-sign":"+","inserted-arrow":">",unchanged:" ",diff:"!"};Object.keys(r).forEach(function(e){var a=r[e],n=[];if(!/^\w+$/.test(e))n.push(/\w+/.exec(e)[0]);if(e==="diff")n.push("bold");i.languages.diff[e]={pattern:RegExp("^(?:["+a+`].*(?:\r
?|
|(?![\\s\\S])))+`,"m"),alias:n,inside:{line:{pattern:/(.)(?=[\s\S]).*(?:\r\n?|\n)?/,lookbehind:!0},prefix:{pattern:/[\s\S]/,alias:/\w+/.exec(e)[0]}}}}),Object.defineProperty(i.languages.diff,"PREFIXES",{value:r})})(Prism);

//# debugId=36218E703ECA01BE64756E2164756E21
//# sourceMappingURL=prism-diff-ede62hvy.js.map
