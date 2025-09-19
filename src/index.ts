import 'dotenv/config';
import ClientOAuth2 from 'client-oauth2';
import express from 'express';
import fetch from 'node-fetch';
import _ from 'lodash';

import qs from 'qs';
import fs from 'fs';

const localip = '192.168.68.50';

const ronWithingsAuth = new ClientOAuth2({
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    accessTokenUri: 'https://wbsapi.withings.net/v2/oauth2',
    authorizationUri: 'https://account.withings.com/oauth2_user/authorize2',
    redirectUri: `http://${localip}:8311/callbackron`,
    scopes: ['user.info,user.metrics,user.activity']
});

const ronbpWithingsAuth = new ClientOAuth2({
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    accessTokenUri: 'https://wbsapi.withings.net/v2/oauth2',
    authorizationUri: 'https://account.withings.com/oauth2_user/authorize2',
    redirectUri: `http://${localip}:8311/callbackronbp`,
    scopes: ['user.info,user.metrics,user.activity']
});

const ronbpgWithingsAuth = new ClientOAuth2({
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    accessTokenUri: 'https://wbsapi.withings.net/v2/oauth2',
    authorizationUri: 'https://account.withings.com/oauth2_user/authorize2',
    redirectUri: `http://${localip}:8311/callbackronbpg`,
    scopes: ['user.info,user.metrics,user.activity']
});


const basicWithingsAuth = new ClientOAuth2({
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    accessTokenUri: 'https://wbsapi.withings.net/v2/oauth2',
    authorizationUri: 'https://account.withings.com/oauth2_user/authorize2',
    redirectUri: `http://${localip}:8311/callback`,
    scopes: ['user.info,user.metrics,user.activity']
});


const app = express();
const port = 8311;

app.get('/', (_req, res) => {
    const uri = basicWithingsAuth.code.getUri({ state: 'some state' });
    res.redirect(uri); // redirect user to Withings authorization page
});

app.get('/ron', (_req, res) => {
    const uri = ronWithingsAuth.code.getUri({ state: 'some state' });
    res.redirect(uri); // redirect user to Withings authorization page
});

app.get('/ronbp', (_req, res) => {
    const uri = ronbpWithingsAuth.code.getUri({ state: 'some state' });
    res.redirect(uri); // redirect user to Withings authorization page
});

app.get('/ronbpg', (_req, res) => {
    const uri = ronbpgWithingsAuth.code.getUri({ state: 'some state' });
    res.redirect(uri); // redirect user to Withings authorization page
});

app.get('/callbackron', (req, res) => {
    //const code = req.query.code as string;
    ronWithingsAuth.code.getToken(req.originalUrl, {
        body: {
            action: 'requesttoken',
            client_id: String(process.env.CLIENT_ID),
            client_secret: String(process.env.CLIENT_SECRET),
        }
    })
        .then(async function (user) {
            // console.log(user) //=> { accessToken: '...', tokenType: 'bearer', ... }

            user.accessToken = (user as any).data.body.access_token;
            user.refreshToken = (user as any).data.body.refresh_token;

            const query = {
                action: 'getmeas',
                meastype: 1,
                category: 1,
                startdate: Math.floor(new Date(2009, 1, 1).getTime() / 1000),
                enddate: Math.floor(new Date().getTime() / 1000),
                offset: 0
            }
            const qstr = qs.stringify(query);

            const url = `https://wbsapi.withings.net/measure`;

            const data = await fetch(url, {
                method: 'POST',
                body: qstr,
                headers: {
                    authorization: `Bearer ${user.accessToken}`
                }
            });

            const json = await data.json();

            const twentyten = new Date(2010, 1, 1);

            function daysSincetwentyTen(date: Date) {
                return Math.floor((date.getTime() - twentyten.getTime()) / (1000 * 60 * 60 * 24));
            }

            function dateStr(date: Date) {
                const y = date.getFullYear();
                const m = String(date.getMonth() + 1).padStart(2, '0');
                const d = String(date.getDate()).padStart(2, '0');
                return `${y}-${m}-${d}`;
            }

            const weights = json.body.measuregrps.map((x: any) => {
                const d = new Date(x.date * 1000);

                let lb = Math.round((x.measures[0].value / 1000) * 2.20462 * 10) / 10;
                if (x.measures[0].unit == -3) {
                    // nothing
                }
                else if (x.measures[0].unit == -2) {
                    lb = Math.round((x.measures[0].value / 100) * 2.20462 * 10) / 10;
                }
                else {
                    debugger;
                }

                return {
                    rawDate: x.date,
                    measure: x.measures[0].value,
                    date: dateStr(d),
                    day: dateStr(d).substring(5),
                    daysSincetwentyTen: daysSincetwentyTen(d),
                    lb
                }
            }).sort((x: any, y: any) => x.rawDate - y.rawDate);

            let last = weights[0];
            const injected = [last];

            for (let i = 1; i < weights.length; i++) {
                const next = weights[i];
                const diff = next.daysSincetwentyTen - last.daysSincetwentyTen;
                if (diff == 0)
                    continue;
                if (diff > 1) {
                    const weightDiff = next.lb - last.lb;
                    const weightPerDay = weightDiff / diff;
                    const start = new Date(last.date).getTime();

                    for (let d = 1; d < diff; d++) {
                        const date = new Date(start + d * 24 * 60 * 60 * 1000);
                        const dstt = daysSincetwentyTen(date);
                        let lb = Math.round((last.lb + d * weightPerDay) * 10) / 10;
                        if (last)
                            injected.push({
                                date: date.toISOString().split('T')[0],
                                day: date.toISOString().split('T')[0].substr(5),
                                daysSincetwentyTen: dstt,
                                lb,
                                injected: true
                            });
                    }
                }
                injected.push(next);
                last = next;
            }

            const pandyEntries = injected.filter(x => {
                const yr = new Date(x.date).getFullYear();
                return yr >= 2020;
            });

            const pandyMax = pandyEntries.map(x => x.lb).reduce((a, b) => Math.max(a, b), 0);


            const addYear = (year: number) => {
                const lastYear = 2022; //new Date().getFullYear() - 1;
                const entries = injected.filter(x => x.date.startsWith(year));

                const lastYearEntries = injected.filter(x => x.date.startsWith(lastYear));
                for (const entry of lastYearEntries) {
                    const e = entries.find(x => x.day == entry.day);
                    entry[year] = e?.lb;
                }
            }

            const years = [2023, 2024];
            years.forEach(addYear);

            for (const entry of pandyEntries) {
                entry.lbminus = entry.lb - pandyMax;
                for (const year of years) {
                    if (entry[year]) {
                        entry[`lbminus${year}`] = entry[year] - pandyMax;
                    }
                }
            }

            let mappings = {
                'daysSincetwentyTen': { header: 'Days since 2010', transform: (x: any) => x },
                'injected': { header: 'Injected', transform: (x: any) => !!x ? 'true' : '' },
                'date': { header: 'Date', transform: (x: any) => x },
                'lb': { header: 'Weight (lb)', transform: (x: any) => x },
                'day': { header: 'Day', transform: (x: any) => x },
                'lbminus': { header: 'Delta', transform: (x: any) => x },
            } as any;

            years.forEach(year => {
                //mappings[year] = { header: `Weight (${year})`, transform: (x: any) => x }
                mappings[`lbminus${year}`] = { header: `Delta (${year})`, transform: (x: any) => !!x ? x : '' }
            });

            const lines = injected.map((x: any) => {
                return Object.keys(mappings).map(k => mappings[k].transform(x[k])).join(',');
            });

            const header = Object.keys(mappings).map(k => mappings[k].header).join(',');
            lines.unshift(header);

            // gets a stamp in the format of YYYY-MM-DD
            const stamp = new Date().toISOString().split('T')[0];

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="ron-${stamp}.csv"`);

            res.send(lines.join('\r\n')).end();
        })
        .catch(err => {

            res.send(err.message + err.stack);
        });
});

app.get('/callbackronbp', (req, res) => {
    ronbpWithingsAuth.code.getToken(req.originalUrl, {
        body: {
            action: 'requesttoken',
            client_id: String(process.env.CLIENT_ID),
            client_secret: String(process.env.CLIENT_SECRET),
        }
    })
        .then(async function (user) {
            user.accessToken = (user as any).data.body.access_token;
            user.refreshToken = (user as any).data.body.refresh_token;

            const query = {
                action: 'getmeas',
                meastype: [9, 10, 11],
                category: 1,
                startdate: Math.floor(new Date(2009, 1, 1).getTime() / 1000),
                enddate: Math.floor(new Date().getTime() / 1000),
                offset: 0
            }
            const qstr = qs.stringify(query);

            const url = `https://wbsapi.withings.net/measure`;

            const data = await fetch(url, {
                method: 'POST',
                body: qstr,
                headers: {
                    authorization: `Bearer ${user.accessToken}`
                }
            });

            const json = await data.json();
            // function dateStr(date: Date) {
            //     const y = date.getFullYear();
            //     const m = String(date.getMonth() + 1).padStart(2, '0');
            //     const d = String(date.getDate()).padStart(2, '0');
            //     return `${y}-${m}-${d}`;
            // }

            const bps = json.body.measuregrps.map((x: any) => {
                const d = new Date(x.date * 1000);
                const sbpmeasure = x.measures.find((m: any) => m.type == 10);
                const dbpmeasure = x.measures.find((m: any) => m.type == 9);
                const pulmeasure = x.measures.find((m: any) => m.type == 11);

                if (sbpmeasure == null && dbpmeasure == null && pulmeasure == null)
                    return null;

                const localDate = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
                const period = d.getHours() <= 10 ? 'morning' : d.getHours() <= 16 ? 'afternoon' : 'evening';
                const bucket = localDate + ' ' + period;

                return {
                    rawDate: x.date,
                    dateRaw: d,
                    dateIso: d.toISOString(),
                    localDate,
                    bucket,
                    period,
                    sbp: sbpmeasure.value * Math.pow(10, sbpmeasure.unit),
                    dbp: dbpmeasure.value * Math.pow(10, dbpmeasure.unit),
                    pul: pulmeasure.value * Math.pow(10, pulmeasure.unit)
                }
            }).filter((x: any) => !!x).sort((x: any, y: any) => x.rawDate - y.rawDate);

            const groups = _.groupBy(bps, x => x.bucket);
            // find the lowest bp per bucket and add it to the list
            const final = Object.keys(groups).map(k => {
                const bucket = groups[k];
                const min = _.minBy(bucket, x => x.sbp + x.dbp);
                return min;
            });

            let mappings = {
                'localDate': { header: 'Date', transform: (x: any) => x },
                'period': { header: 'Period', transform: (x: any) => x },
                'sbp': { header: 'Systolic', transform: (x: any) => x },
                'dbp': { header: 'Diastolic', transform: (x: any) => x },
                'pul': { header: 'Pulse', transform: (x: any) => x }
            } as any;

            const lines = final.map((x: any) => {
                return Object.keys(mappings).map(k => mappings[k].transform(x[k])).join(',');
            });

            const header = Object.keys(mappings).map(k => mappings[k].header).join(',');
            lines.unshift(header);

            // gets a stamp in the format of YYYY-MM-DD
            const stamp = new Date().toISOString().split('T')[0];

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="${stamp}-bp.csv"`);

            res.send(lines.join('\r\n')).end();
        })
        .catch(err => {
            res.send(err.message + err.stack);
        });
});

app.get('/callbackronbpg', (req, res) => {
    ronbpgWithingsAuth.code.getToken(req.originalUrl, {
        body: {
            action: 'requesttoken',
            client_id: String(process.env.CLIENT_ID),
            client_secret: String(process.env.CLIENT_SECRET),
        }
    })
        .then(async function (user) {
            user.accessToken = (user as any).data.body.access_token;
            user.refreshToken = (user as any).data.body.refresh_token;

            const query = {
                action: 'getmeas',
                meastype: [9, 10, 11],
                category: 1,
                startdate: Math.floor(new Date(2009, 1, 1).getTime() / 1000),
                enddate: Math.floor(new Date().getTime() / 1000),
                offset: 0
            }
            const qstr = qs.stringify(query);

            const url = `https://wbsapi.withings.net/measure`;

            const data = await fetch(url, {
                method: 'POST',
                body: qstr,
                headers: {
                    authorization: `Bearer ${user.accessToken}`
                }
            });

            const json = await data.json();
            const bps = json.body.measuregrps.map((x: any) => {
                const d = new Date(x.date * 1000);
                const sbpmeasure = x.measures.find((m: any) => m.type == 10);
                const dbpmeasure = x.measures.find((m: any) => m.type == 9);
                const pulmeasure = x.measures.find((m: any) => m.type == 11);

                if (sbpmeasure == null && dbpmeasure == null && pulmeasure == null)
                    return null;

                const localDate = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
                const period = d.getHours() <= 10 ? 'morning' : d.getHours() <= 16 ? 'afternoon' : 'evening';
                const bucket = localDate + ' ' + period;

                return {
                    rawDate: x.date,
                    dateRaw: d,
                    dateIso: d.toISOString(),
                    localDate,
                    bucket,
                    period,
                    sbp: sbpmeasure.value * Math.pow(10, sbpmeasure.unit),
                    dbp: dbpmeasure.value * Math.pow(10, dbpmeasure.unit),
                    pul: pulmeasure.value * Math.pow(10, pulmeasure.unit)
                }
            }).filter((x: any) => !!x).sort((x: any, y: any) => x.rawDate - y.rawDate);

            const groups = _.groupBy(bps, x => x.bucket);
            // find the lowest bp per bucket and add it to the list
            const final = Object.keys(groups).map(k => {
                const bucket = groups[k];
                const min = _.minBy(bucket, x => x.sbp + x.dbp);
                return min;
            });

            const groups2 = _.groupBy(bps, x => x.localDate);
            // split the periods into different columns
            const final2 = Object.keys(groups2).map(k => {
                const bucket = groups2[k];
                const morning = bucket.find(x => x.period == 'morning');
                const afternoon = bucket.find(x => x.period == 'afternoon');
                const evening = bucket.find(x => x.period == 'evening');
                return {
                    localDate: k,
                    morningspb: morning ? morning.sbp : '',
                    morningdbp: morning ? morning.dbp : '',
                    morningpul: morning ? morning.pul : '',
                    afternoonsbp: afternoon ? afternoon.sbp : '',
                    afternoondbp: afternoon ? afternoon.dbp : '',
                    afternoonpul: afternoon ? afternoon.pul : '',
                    eveningsbp: evening ? evening.sbp : '',
                    eveningdbp: evening ? evening.dbp : '',
                    eveningpul: evening ? evening.pul : ''
                }
            });

            let mappings = {
                'localDate': { header: 'Date', transform: (x: any) => x },
                'morningspb': { header: 'Morning Systolic', transform: (x: any) => x },
                'morningdbp': { header: 'Morning Diastolic', transform: (x: any) => x },
                'afternoonsbp': { header: 'Afternoon Systolic', transform: (x: any) => x },
                'afternoondbp': { header: 'Afternoon Diastolic', transform: (x: any) => x },
                'eveningsbp': { header: 'Evening Systolic', transform: (x: any) => x },
                'eveningdbp': { header: 'Evening Diastolic', transform: (x: any) => x },
                'morningpul': { header: 'Morning Pulse', transform: (x: any) => x },
                'afternoonpul': { header: 'Afternoon Pulse', transform: (x: any) => x },
                'eveningpul': { header: 'Evening Pulse', transform: (x: any) => x }
            } as any;

            const lines = final2.map((x: any) => {
                return Object.keys(mappings).map(k => mappings[k].transform(x[k])).join(',');
            });

            const header = Object.keys(mappings).map(k => mappings[k].header).join(',');
            lines.unshift(header);

            // gets a stamp in the format of YYYY-MM-DD
            const stamp = new Date().toISOString().split('T')[0];

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="${stamp}-bpg.csv"`);

            res.send(lines.join('\r\n')).end();
        })
        .catch(err => {
            res.send(err.message + err.stack);
        });
});



app.get('/callback', (req, res) => {
    basicWithingsAuth.code.getToken(req.originalUrl, {
        body: {
            action: 'requesttoken',
            client_id: String(process.env.CLIENT_ID),
            client_secret: String(process.env.CLIENT_SECRET),
        }
    })
        .then(async function (user) {
            user.accessToken = (user as any).data.body.access_token;
            user.refreshToken = (user as any).data.body.refresh_token;

            const query = {
                action: 'getmeas',
                meastype: [1, 5, 6],
                category: 1,
                startdate: Math.floor(new Date(2009, 1, 1).getTime() / 1000),
                enddate: Math.floor(new Date().getTime() / 1000),
                offset: 0
            }
            const qstr = qs.stringify(query);

            const url = `https://wbsapi.withings.net/measure`;

            const data = await fetch(url, {
                method: 'POST',
                body: qstr,
                headers: {
                    authorization: `Bearer ${user.accessToken}`
                }
            });

            const json = await data.json();
            function dateStr(date: Date) {
                const y = date.getFullYear();
                const m = String(date.getMonth() + 1).padStart(2, '0');
                const d = String(date.getDate()).padStart(2, '0');
                return `${y}-${m}-${d}`;
            }

            const weights = json.body.measuregrps.map((x: any) => {
                const d = new Date(x.date * 1000);

                const lb = x.measures.find((m: any) => m.type == 1)?.value;
                const lm = x.measures.find((m: any) => m.type == 5)?.value;
                const fp = x.measures.find((m: any) => m.type == 6)?.value;

                if (lb == null && lm == null && fp == null)
                    return null;

                const lm2 = Math.round((lm / 1000) * 2.20462 * 10) / 10;
                const fp2 = fp / 1000;

                return {
                    rawDate: x.date,
                    measure: lb,
                    date: dateStr(d),
                    lb: Math.round((lb / 1000) * 2.20462 * 10) / 10,
                    lm: isNaN(lm2) ? '' : lm2,
                    fp: isNaN(fp2) ? '' : fp2,
                }
            }).filter((x: any) => !!x).sort((x: any, y: any) => x.rawDate - y.rawDate);

            let mappings = {
                'date': { header: 'Date', transform: (x: any) => x },
                'lb': { header: 'Weight (lb)', transform: (x: any) => x },
                'lm': { header: 'Lean Mass (lb)', transform: (x: any) => x },
                'fp': { header: 'Fat Percentage', transform: (x: any) => x }
            } as any;

            const lines = weights.map((x: any) => {
                return Object.keys(mappings).map(k => mappings[k].transform(x[k])).join(',');
            });

            const header = Object.keys(mappings).map(k => mappings[k].header).join(',');
            lines.unshift(header);

            // gets a stamp in the format of YYYY-MM-DD
            const stamp = new Date().toISOString().split('T')[0];

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="${stamp}.csv"`);

            res.send(lines.join('\r\n')).end();
        })
        .catch(err => {
            res.send(err.message + err.stack);
        });
});


app.get('/loggedin', async (req, res) => {
    res.send('You are logged in, I think!');
});

app.listen(port, () => {
    console.log(`App listening at http://localhost:${port}`);
});
