import 'dotenv/config';
import ClientOAuth2 from 'client-oauth2';
import express from 'express';
import fetch from 'node-fetch';

import qs from 'qs';
import fs from 'fs';

const withingsAuth = new ClientOAuth2({
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    accessTokenUri: 'https://wbsapi.withings.net/v2/oauth2',
    authorizationUri: 'https://account.withings.com/oauth2_user/authorize2',
    redirectUri: 'http://localhost:8111/callback', // replace with your callback URL
    scopes: ['user.info,user.metrics,user.activity'] // replace with the scopes you need
});

const app = express();
const port = 8111;

app.get('/', (_req, res) => {
    const uri = withingsAuth.code.getUri({ state: 'some state' });
    res.redirect(uri); // redirect user to Withings authorization page
});

app.get('/callback', (req, res) => {
    //const code = req.query.code as string;
    withingsAuth.code.getToken(req.originalUrl, {
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

                return {
                    rawDate: x.date,
                    measure: x.measures[0].value,
                    date: dateStr(d),
                    day: dateStr(d).substring(5),
                    daysSincetwentyTen: daysSincetwentyTen(d),
                    lb: Math.round((x.measures[0].value / 1000) * 2.20462 * 10) / 10,
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
                        const lb = Math.round((last.lb + d * weightPerDay) * 10) / 10;
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
                const lastYear = new Date().getFullYear() - 1;
                const entries = injected.filter(x => x.date.startsWith(year));

                const lastYearEntries = injected.filter(x => x.date.startsWith(lastYear));
                for (const entry of lastYearEntries) {
                    const e = entries.find(x => x.day == entry.day);
                    entry[year] = e?.lb;
                }
            }

            const years = [2023];
            years.forEach(addYear);

            for (const entry of pandyEntries) {
                entry.lbminus = entry.lb - pandyMax;
                if (entry[2023]) {
                    entry.lbminus2023 = entry[2023] - pandyMax;
                }
            }


            const lines = injected.map((x: any) => `${x.daysSincetwentyTen},${x.injected ? 'true' : ''},${x.date},${x.day},${x.lb},${x[2023] ?? ''},${x.lbminus ?? ''},${x.lbminus2023 ?? ''}`);
            lines.unshift('Days Since 2010, Injected, Date, Day, Weight (lb), Weight (2023),Delta,Delta 2023'); // add header

            fs.writeFileSync('weights.csv', lines.join('\r\n'));


            //console.log(data);
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
