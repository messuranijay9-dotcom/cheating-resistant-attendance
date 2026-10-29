/*
  Kinetic Interactive Script for Cheating-Resistant Attendance System
  Adapted from templatemo-631-kinetic-script.js
*/

(function() {
    "use strict";
    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* =====================================================
       01 // ELASTIC STRING PHYSICS & KINETIC BOX FIELD
       ===================================================== */
    (function() {
        var hero = document.getElementById('hero');
        var svg = document.getElementById('stringSvg');
        var path = document.getElementById('stringPath');
        var aL = document.getElementById('anchorL');
        var aR = document.getElementById('anchorR');
        var grip = document.getElementById('grip');

        if (!hero || !svg || !path || !aL || !aR || !grip) return;

        // ---- kinetic box field ----
        var field = document.createElement('div');
        field.className = 'field';
        hero.insertBefore(field, hero.firstChild);

        var boxes = [];
        var COUNT = 20;
        for (var bi = 0; bi < COUNT; bi++) {
            var el = document.createElement('div');
            var roll = Math.random();
            el.className = 'box' + (roll < 0.18 ? ' acid' : (roll < 0.36 ? ' warm' : ''));
            var bw = 26 + Math.random() * 96;
            var bh = (Math.random() < 0.80) ? bw : (26 + Math.random() * 96); // mostly squares
            el.style.width = bw.toFixed(0) + 'px';
            el.style.height = bh.toFixed(0) + 'px';
            var fx = Math.random(); // 0..1 across hero
            var fy = 0.08 + Math.random() * 0.84; // keep clear of very top/bottom
            el.style.left = (fx * 100).toFixed(2) + '%';
            el.style.top = (fy * 100).toFixed(2) + '%';
            el.style.marginLeft = (-bw / 2) + 'px';
            el.style.marginTop = (-bh / 2) + 'px';
            field.appendChild(el);
            boxes.push({
                el: el,
                fx: fx,
                fy: fy,
                w: bw,
                h: bh,
                rot: (Math.random() * 2 - 1) * 14,
                oy: 0,
                ox: 0,
                vx: 0,
                vy: 0,
                prevRopeY: 0
            });
        }

        var W = 0,
            H = 0,
            baseY = 0;

        function size() {
            var r = hero.getBoundingClientRect();
            W = r.width;
            H = r.height;
            baseY = H / 2;
            svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
            aL.setAttribute('cx', 0);
            aL.setAttribute('cy', baseY);
            aR.setAttribute('cx', W);
            aR.setAttribute('cy', baseY);
        }

        function relaxHomes() {
            if (!W || !H) return;
            var m = 12;
            var pts = boxes.map(function(b) {
                return {
                    x: b.fx * W,
                    y: b.fy * H,
                    hw: b.w / 2,
                    hh: b.h / 2
                };
            });
            for (var it = 0; it < 16; it++) {
                for (var a = 0; a < pts.length; a++) {
                    for (var c = a + 1; c < pts.length; c++) {
                        var pa = pts[a],
                            pb = pts[c];
                        var dx = pa.x - pb.x,
                            dy = pa.y - pb.y;
                        var ox = (pa.hw + pb.hw + 8) - Math.abs(dx);
                        var oy = (pa.hh + pb.hh + 8) - Math.abs(dy);
                        if (ox > 0 && oy > 0) {
                            if (ox < oy) {
                                var s = (dx < 0 ? -1 : 1) * ox * 0.5;
                                pa.x += s;
                                pb.x -= s;
                            } else {
                                var s2 = (dy < 0 ? -1 : 1) * oy * 0.5;
                                pa.y += s2;
                                pb.y -= s2;
                            }
                        }
                    }
                }
                for (var q = 0; q < pts.length; q++) {
                    var p = pts[q];
                    if (p.x < p.hw + m) p.x = p.hw + m;
                    else if (p.x > W - p.hw - m) p.x = W - p.hw - m;
                    if (p.y < p.hh + m) p.y = p.hh + m;
                    else if (p.y > H - p.hh - m) p.y = H - p.hh - m;
                }
            }
            boxes.forEach(function(b, idx) {
                b.fx = pts[idx].x / W;
                b.fy = pts[idx].y / H;
                b.el.style.left = (b.fx * 100).toFixed(3) + '%';
                b.el.style.top = (b.fy * 100).toFixed(3) + '%';
            });
        }
        size();
        relaxHomes();
        window.addEventListener('resize', function() {
            size();
            relaxHomes();
        });

        // spring state: posX/posY = apex target the curve reaches
        var mouseX = 0,
            mouseY = 0,
            active = false;
        var posX = 0,
            posY = 0,
            velX = 0,
            velY = 0;

        hero.addEventListener('pointermove', function(e) {
            var r = hero.getBoundingClientRect();
            mouseX = e.clientX - r.left;
            mouseY = e.clientY - r.top;
            active = true;
        });
        hero.addEventListener('pointerleave', function() {
            active = false;
        });

        function draw() {
            if (W === 0) size();
            posX = (active ? mouseX : W / 2);

            if (reduceMotion) {
                posY = baseY; // flat, no physics
            } else {
                var targetY = active ? mouseY : baseY;
                var k = 0.055,
                    damp = 0.80; // low damping = visible spring bounce
                velY += (targetY - posY) * k;
                velY *= damp;
                posY += velY;
            }

            // quadratic control point so the curve APEX lands on (posX, posY)
            var cy = 2 * posY - baseY;
            path.setAttribute('d', 'M 0 ' + baseY + ' Q ' + posX + ' ' + cy + ' ' + W + ' ' + baseY);

            grip.setAttribute('cx', posX);
            grip.setAttribute('cy', posY);
            grip.setAttribute('opacity', active ? 1 : 0);

            // === rope as a physical body: it touches boxes and flings them ===
            var ROPE_HALF = 14; // effective rope thickness for contact
            var FRICTION = 0.85;
            var HOME = 0.010; // weak drift back toward origin
            var k3, b;

            function ropeYAt(x) {
                var A = W - 2 * posX,
                    t;
                if (Math.abs(A) < 0.0001) {
                    t = x / W;
                } else {
                    var disc = posX * posX + A * x;
                    if (disc < 0) disc = 0;
                    t = (-posX + Math.sqrt(disc)) / A;
                }
                if (t < 0) t = 0;
                else if (t > 1) t = 1;
                var omt = 1 - t;
                return omt * omt * baseY + 2 * omt * t * cy + t * t * baseY;
            }

            // 1) integrate each box under rope contact + weak home drift
            for (k3 = 0; k3 < boxes.length; k3++) {
                b = boxes[k3];
                var hh = b.h / 2,
                    hw = b.w / 2;
                var px = b.fx * W + b.ox;
                var py = b.fy * H + b.oy;

                if (!reduceMotion) {
                    var nearest = ropeYAt(px);
                    var rl = ropeYAt(px - hw),
                        rr = ropeYAt(px + hw);
                    if (Math.abs(rl - py) < Math.abs(nearest - py)) nearest = rl;
                    if (Math.abs(rr - py) < Math.abs(nearest - py)) nearest = rr;

                    var gap = py - nearest;
                    var pen = (hh + ROPE_HALF) - Math.abs(gap);
                    if (pen > 0) {
                        var dir = gap === 0 ? (b.fy < 0.5 ? -1 : 1) : (gap > 0 ? 1 : -1);
                        b.vy += dir * pen * 0.16;
                        b.vy += (nearest - b.prevRopeY) * 0.55;
                    }
                    b.prevRopeY = nearest;
                }

                b.vx += -b.ox * HOME;
                b.vy += -b.oy * HOME;
                b.vx *= FRICTION;
                b.vy *= FRICTION;
                b.ox += b.vx;
                b.oy += b.vy;
            }

            // 2) separation so boxes shove each other apart, never overlap
            if (!reduceMotion) {
                for (var pass = 0; pass < 3; pass++) {
                    for (var a2 = 0; a2 < boxes.length; a2++) {
                        for (var c2 = a2 + 1; c2 < boxes.length; c2++) {
                            var ba = boxes[a2],
                                bb = boxes[c2];
                            var ddx = (ba.fx * W + ba.ox) - (bb.fx * W + bb.ox);
                            var ddy = (ba.fy * H + ba.oy) - (bb.fy * H + bb.oy);
                            var ox2 = (ba.w / 2 + bb.w / 2 + 6) - Math.abs(ddx);
                            var oy2 = (ba.h / 2 + bb.h / 2 + 6) - Math.abs(ddy);
                            if (ox2 > 0 && oy2 > 0) {
                                if (ox2 < oy2) {
                                    var sh = (ddx < 0 ? -1 : 1) * ox2 * 0.30;
                                    ba.ox += sh;
                                    bb.ox -= sh;
                                    ba.vx *= 0.5;
                                    bb.vx *= 0.5;
                                } else {
                                    var sv = (ddy < 0 ? -1 : 1) * oy2 * 0.30;
                                    ba.oy += sv;
                                    bb.oy -= sv;
                                    ba.vy *= 0.5;
                                    bb.vy *= 0.5;
                                }
                            }
                        }
                    }
                }
            }

            // 3) render, clamped inside the hero
            for (k3 = 0; k3 < boxes.length; k3++) {
                var bo = boxes[k3];
                var bhw = bo.w / 2,
                    bhh = bo.h / 2,
                    hx = bo.fx * W,
                    hy = bo.fy * H;
                var minOx = (bhw + 4) - hx,
                    maxOx = (W - bhw - 4) - hx;
                var minOy = (bhh + 4) - hy,
                    maxOy = (H - bhh - 4) - hy;
                if (bo.ox < minOx) {
                    bo.ox = minOx;
                    if (bo.vx < 0) bo.vx = 0;
                } else if (bo.ox > maxOx) {
                    bo.ox = maxOx;
                    if (bo.vx > 0) bo.vx = 0;
                }
                if (bo.oy < minOy) {
                    bo.oy = minOy;
                    if (bo.vy < 0) bo.vy = 0;
                } else if (bo.oy > maxOy) {
                    bo.oy = maxOy;
                    if (bo.vy > 0) bo.vy = 0;
                }
                bo.el.style.transform =
                    'translate(' + bo.ox.toFixed(1) + 'px,' + bo.oy.toFixed(1) + 'px) rotate(' +
                    (bo.rot + bo.oy * 0.10).toFixed(2) + 'deg)';
            }

            requestAnimationFrame(draw);
        }
        posX = W / 2;
        posY = baseY;
        requestAnimationFrame(draw);
    })();

    /* =====================================================
       02 // 2D MATRIX ACCORDION
       ===================================================== */
    (function() {
        var grid = document.getElementById('matrix');
        if (!grid) return;
        var cells = Array.prototype.slice.call(grid.querySelectorAll('.cell'));
        var activeIndex = -1;
        var BIG = 7; // active track weight vs 1fr others -> ~78% per axis

        function reset() {
            grid.style.gridTemplateColumns = '1fr 1fr 1fr';
            grid.style.gridTemplateRows = '1fr 1fr 1fr';
            cells.forEach(function(c) {
                c.classList.remove('is-active', 'is-dim');
            });
            activeIndex = -1;
        }

        function open(i) {
            var col = i % 3,
                row = Math.floor(i / 3);
            var cols = ['1fr', '1fr', '1fr'],
                rows = ['1fr', '1fr', '1fr'];
            cols[col] = BIG + 'fr';
            rows[row] = BIG + 'fr';
            grid.style.gridTemplateColumns = cols.join(' ');
            grid.style.gridTemplateRows = rows.join(' ');
            cells.forEach(function(c, j) {
                c.classList.toggle('is-active', j === i);
                c.classList.toggle('is-dim', j !== i);
            });
            activeIndex = i;
        }
        cells.forEach(function(cell, i) {
            function toggle() {
                (activeIndex === i) ? reset(): open(i);
            }
            cell.addEventListener('click', toggle);
            cell.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggle();
                }
                if (e.key === 'Escape') {
                    reset();
                }
            });
        });
    })();

    /* =====================================================
       03 // LENTICULAR STRIP REVEAL
       ===================================================== */
    (function() {
        var lenti = document.getElementById('lenti');
        if (!lenti) return;
        var N = 10;
        var FRONT = lenti.getAttribute('data-front') || '';
        var BACK = lenti.getAttribute('data-back') || FRONT;

        var slices = [];
        var sizeRef = {
            w: 0
        };

        function buildSliceBg() {
            var r = lenti.getBoundingClientRect();
            sizeRef.w = r.width;
            slices.forEach(function(s, i) {
                var offset = -(i * (r.width / N)) + 1;
                s.front.style.backgroundSize = r.width + 'px ' + r.height + 'px';
                s.back.style.backgroundSize = r.width + 'px ' + r.height + 'px';
                s.front.style.backgroundPosition = offset + 'px 0';
                s.back.style.backgroundPosition = offset + 'px 0';
                s.back.style.transform = '';
            });
        }

        for (var i = 0; i < N; i++) {
            var slice = document.createElement('div');
            slice.className = 'slice';

            var front = document.createElement('div');
            front.className = 'face front';
            front.style.backgroundImage =
                'linear-gradient(rgba(208,255,0,.10), rgba(8,8,10,.30))' + (FRONT ? ", url('" + FRONT + "')" : '');

            var back = document.createElement('div');
            back.className = 'face back';
            back.style.backgroundImage =
                'linear-gradient(rgba(255,158,94,.28), rgba(8,8,10,.30))' + (BACK ? ", url('" + BACK + "')" : '');
            back.style.transform = 'rotateY(180deg) scaleX(-1)';
            back.style.backgroundPositionX = 'right';

            slice.appendChild(front);
            slice.appendChild(back);
            lenti.appendChild(slice);
            slices.push({
                el: slice,
                front: front,
                back: back,
                cur: 0
            });
        }
        buildSliceBg();
        window.addEventListener('resize', buildSliceBg);

        var stage = document.getElementById('lentiStage');
        if (!stage) return;
        var engaged = false,
            frac = 0;
        stage.addEventListener('pointermove', function(e) {
            var r = lenti.getBoundingClientRect();
            var f = (e.clientX - r.left) / r.width;
            if (f < -0.3) f = -0.3;
            if (f > 1.3) f = 1.3;
            frac = f;
            engaged = true;
        });
        stage.addEventListener('pointerleave', function() {
            engaged = false;
        });

        function clamp(v, a, b) {
            return v < a ? a : (v > b ? b : v);
        }

        function loop() {
            if (reduceMotion) {
                requestAnimationFrame(loop);
                return;
            }
            for (var j = 0; j < N; j++) {
                var sp = j / (N - 1);
                var goal;
                if (!engaged) {
                    goal = 0;
                } else {
                    var d = frac - sp;
                    var band = 0.16;
                    var base = clamp((d + band) / (2 * band), 0, 1);
                    var mid = Math.sin(base * Math.PI);
                    var ripple = Math.sin(j * 0.85 + frac * 6.0) * 10 * mid;
                    goal = clamp(base * 180 + ripple, 0, 180);
                }
                var s = slices[j];
                s.cur += (goal - s.cur) * 0.16;
                s.el.style.transform = 'rotateY(' + s.cur.toFixed(2) + 'deg)';
            }
            requestAnimationFrame(loop);
        }
        requestAnimationFrame(loop);
    })();

    /* =====================================================
       04 // TYPOGRAPHIC SCATTER & SIGNATURE
       ===================================================== */
    (function() {
        var host = document.getElementById('scatter');
        var foot = document.getElementById('initiate');
        var subWrap = document.getElementById('subWrap');
        var subForm = document.getElementById('subscribe');
        var subEmail = document.getElementById('subEmail');
        var subNote = document.getElementById('subNote');

        if (!host || !foot) return;
        var text = host.textContent;
        host.textContent = '';

        if (subForm && subEmail && subNote) {
            subForm.addEventListener('submit', function(e) {
                e.preventDefault();
                var v = (subEmail.value || '').trim();
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
                    subNote.textContent = 'Enter a valid email address';
                    return;
                }
                subNote.textContent = 'Subscribed to system alerts.';
                subEmail.value = '';
            });
        }

        function setFormVisibility(c) {
            if (!subWrap) return;
            var vis = clamp(1 - c * 1.8, 0, 1);
            subWrap.style.opacity = vis.toFixed(3);
            subWrap.style.transform = 'translateY(' + (c * 26).toFixed(1) + 'px)';
            subWrap.style.pointerEvents = vis < 0.4 ? 'none' : 'auto';
        }

        var glyphs = [];
        for (var i = 0; i < text.length; i++) {
            var ch = text[i];
            var span = document.createElement('span');
            span.className = 'glyph';
            if (ch === ' ') {
                span.classList.add('space');
                span.innerHTML = '&nbsp;';
            } else {
                span.textContent = ch;
                if (ch === '/') span.classList.add('slash');
            }
            host.appendChild(span);
            glyphs.push(span);
        }

        function rollVectors() {
            var unit = Math.min(window.innerWidth, window.innerHeight) / 100;
            glyphs.forEach(function(g) {
                g.dataset.tx = ((Math.random() * 2 - 1) * 60 * unit).toFixed(1);
                g.dataset.ty = ((Math.random() * 2 - 1) * 50 * unit).toFixed(1);
                g.dataset.rot = ((Math.random() * 2 - 1) * 70).toFixed(1);
            });
        }
        rollVectors();

        function clamp(v, a, b) {
            return v < a ? a : (v > b ? b : v);
        }

        function apply(v) {
            for (var i = 0; i < glyphs.length; i++) {
                var g = glyphs[i];
                g.style.transform =
                    'translate(' + (parseFloat(g.dataset.tx) * v) + 'px,' +
                    (parseFloat(g.dataset.ty) * v) + 'px) rotate(' +
                    (parseFloat(g.dataset.rot) * v) + 'deg)';
            }
        }

        function scrollProgress() {
            var r = foot.getBoundingClientRect();
            var vh = window.innerHeight;
            var p = clamp((vh - r.top) / vh, 0, 1);
            return p * p;
        }

        var cur = 0,
            manualLock = false,
            exploded = false;

        host.addEventListener('click', function() {
            if (reduceMotion) return;
            if (!manualLock) {
                exploded = cur > 0.5;
                manualLock = true;
            }
            var willExplode = !exploded;
            if (willExplode) rollVectors();
            exploded = willExplode;
        });

        function loop() {
            if (reduceMotion) {
                apply(0);
                setFormVisibility(0);
                requestAnimationFrame(loop);
                return;
            }
            var target = manualLock ? (exploded ? 1 : 0) : scrollProgress();
            if (manualLock) {
                cur += (target - cur) * 0.12;
                if (Math.abs(target - cur) < 0.001) cur = target;
            } else {
                cur = target;
            }
            apply(cur);
            setFormVisibility(cur);
            requestAnimationFrame(loop);
        }
        requestAnimationFrame(loop);

        window.addEventListener('resize', function() {
            if (!exploded) rollVectors();
        });
    })();

    /* =====================================================
       NAV // adapt over the light footer section
       ===================================================== */
    (function() {
        var topbar = document.querySelector('.topbar');
        var light = document.getElementById('initiate');
        if (!topbar || !light) return;
        var navH = 64;

        function sync() {
            var r = light.getBoundingClientRect();
            topbar.classList.toggle('on-light', r.top <= navH && r.bottom >= 0);
        }
        window.addEventListener('scroll', sync, {
            passive: true
        });
        window.addEventListener('resize', sync);
        sync();
    })();

})();

