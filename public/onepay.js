/* eslint-disable */
function OnePay(mcid) {
    this.mcid = mcid;
    this.tid = null;
	this.shopcode = null;
	this.uuid = null;
    this.lastToken = new Date().getTime() - 30 * 60 * 1000 + "0000";
    this.debug = false;
    this.onpaid = null;
    this.qrcode = null;
    this.pubnub = null;

    this.mcc = 5732;
    this.ccy = 418;
    this.province = 'LA';
    this.country = 'VTE';

    this.pubnubSubscribe = function () {
        var channel = this.shopcode ? 'mcid-' + this.mcid + "-" + this.shopcode : 'uuid-' + this.mcid + "-" + this.uuid;
        if(this.tid && this.shopcode){
        	channel = 'tid-' + this.mcid + "-" + this.shopcode + '-' + this.tid;
		}
        this.pubnub.subscribe({
            channels: [channel],
            timetoken: this.lastToken,
			uuid: 'BCELBANK'
        });
    };

    this.paymentCallback = function (res) {
        if (this.onpaid) this.onpaid(res);
        this.onpaid = null; // Stop receiving additional callback
        this.pubnub.stop();
    };

    this.stop = function () {
        this.pubnub.stop();
    };

    this.subscribe = function (params, onpaid) {
        if (this.debug) console.log("subscribe parameters:", params);

        if (this.onpaid != null) throw "You have already subscribed. Please wait until payment is completed to subscribe again, or create a new OnePay object.";

        this.uuid = params.uuid;
        this.tid = params.tid ? params.tid : null;
        this.shopcode = params.shopcode ? params.shopcode : null;
        this.onpaid = onpaid;

        this.pubnub = new PubNub({
            subscribeKey: 'sub-c-91489692-fa26-11e9-be22-ea7c5aada356',
            ssl: true
        });

        this.pubnub.addListener({
            status: function (statusEvent) {
                if (this.debug) console.log("PubNub status changed", statusEvent);

                if (statusEvent.category === "PNNetworkUpCategory")
                    this.pubnubSubscribe()
            }.bind(this),
            message: function (msg) {
                if (this.debug) console.log("Callback received", msg);
                var callback = JSON.parse(msg.message);
                this.paymentCallback(callback)
            }.bind(this)
        });

        this.pubnubSubscribe()
    };

	this.payCode = function (res) {
		if (this.qrcode) this.qrcode(res);
	};

    this.getCode = function (params, qrcode) {
        if (this.debug) console.log("get code parameters:", params);

        this.qrcode = qrcode;
        if (params.mcc) this.mcc = params.mcc;
        if (params.ccy) this.ccy = params.ccy;
        if (params.country) this.country = params.country;
        if (params.province) this.province = params.province;
        if (params.expiretime) this.expiretime = params.expiretime;
        var transactionid = params.transactionid;
		var invoiceid = params.invoiceid;
		var terminalid = params.terminalid;
		var amount = params.amount;
		var description = params.description;

		var $field33 = [
			["00", "BCEL"],
			["01", "ONEPAY"],
			["02", this.mcid]
		];
		if (params.expiretime) $field33.push(["03", getExpiredTime(this.expiretime)]); // expired time
		$field33.push(["05", "CLOSEWHENDONE"]); // close when paid success

		var rawqr = buildqr([
			["00", "01"],
			["01", "11"],
			["33", buildqr($field33)],
			["52", this.mcc],
			["53", this.ccy],
			["54", amount],
			["58", this.country],
			["60", this.province],
			["62", buildqr([
				["01", invoiceid],
				["05", transactionid],
				["07", terminalid],
				["08", description]
			])]
		]);

		var fullqr = rawqr + buildqr([["63", crc16(rawqr + "6304")]]); // Adding itself into checksum
		this.payCode(fullqr);
	};
	

    function getExpiredTime (addMunites) {
        const now = new Date();
      
        const dateFormatter = new Intl.DateTimeFormat("en-US", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        });
      
        const timeFormatter = new Intl.DateTimeFormat("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
          timeZone: "Asia/Bangkok",
        });
      
        const newDate = new Date(now.getTime() + addMunites * 60 * 1000);
      
        const [{ value: month }, , { value: day }, , { value: year }] =
          dateFormatter.formatToParts(now);
        const [{ value: hour }, , { value: minute }, , { value: second }] =
          timeFormatter.formatToParts(newDate);
      
        const nowstr = `${year}${month}${day}${hour}${minute}${second}`;
        return nowstr;
      };
	
	function padLeft(val){
		return val >= 10 ? val : "0" + val;
	}

    function buildqr(arr) {
        var res = "";
        for (var i in arr) {
            var key = arr[i][0];
            var val = arr[i][1];
            if (!val) continue;
            res += pad2(key) + pad2((val + "").length) + val;
        }
        return res;
    }

    function pad2(data) {
        return ("0" + (data + "")).substr(-2);
    }

    var crcTable = [0x0000, 0x1021, 0x2042, 0x3063, 0x4084, 0x50a5,
        0x60c6, 0x70e7, 0x8108, 0x9129, 0xa14a, 0xb16b,
        0xc18c, 0xd1ad, 0xe1ce, 0xf1ef, 0x1231, 0x0210,
        0x3273, 0x2252, 0x52b5, 0x4294, 0x72f7, 0x62d6,
        0x9339, 0x8318, 0xb37b, 0xa35a, 0xd3bd, 0xc39c,
        0xf3ff, 0xe3de, 0x2462, 0x3443, 0x0420, 0x1401,
        0x64e6, 0x74c7, 0x44a4, 0x5485, 0xa56a, 0xb54b,
        0x8528, 0x9509, 0xe5ee, 0xf5cf, 0xc5ac, 0xd58d,
        0x3653, 0x2672, 0x1611, 0x0630, 0x76d7, 0x66f6,
        0x5695, 0x46b4, 0xb75b, 0xa77a, 0x9719, 0x8738,
        0xf7df, 0xe7fe, 0xd79d, 0xc7bc, 0x48c4, 0x58e5,
        0x6886, 0x78a7, 0x0840, 0x1861, 0x2802, 0x3823,
        0xc9cc, 0xd9ed, 0xe98e, 0xf9af, 0x8948, 0x9969,
        0xa90a, 0xb92b, 0x5af5, 0x4ad4, 0x7ab7, 0x6a96,
        0x1a71, 0x0a50, 0x3a33, 0x2a12, 0xdbfd, 0xcbdc,
        0xfbbf, 0xeb9e, 0x9b79, 0x8b58, 0xbb3b, 0xab1a,
        0x6ca6, 0x7c87, 0x4ce4, 0x5cc5, 0x2c22, 0x3c03,
        0x0c60, 0x1c41, 0xedae, 0xfd8f, 0xcdec, 0xddcd,
        0xad2a, 0xbd0b, 0x8d68, 0x9d49, 0x7e97, 0x6eb6,
        0x5ed5, 0x4ef4, 0x3e13, 0x2e32, 0x1e51, 0x0e70,
        0xff9f, 0xefbe, 0xdfdd, 0xcffc, 0xbf1b, 0xaf3a,
        0x9f59, 0x8f78, 0x9188, 0x81a9, 0xb1ca, 0xa1eb,
        0xd10c, 0xc12d, 0xf14e, 0xe16f, 0x1080, 0x00a1,
        0x30c2, 0x20e3, 0x5004, 0x4025, 0x7046, 0x6067,
        0x83b9, 0x9398, 0xa3fb, 0xb3da, 0xc33d, 0xd31c,
        0xe37f, 0xf35e, 0x02b1, 0x1290, 0x22f3, 0x32d2,
        0x4235, 0x5214, 0x6277, 0x7256, 0xb5ea, 0xa5cb,
        0x95a8, 0x8589, 0xf56e, 0xe54f, 0xd52c, 0xc50d,
        0x34e2, 0x24c3, 0x14a0, 0x0481, 0x7466, 0x6447,
        0x5424, 0x4405, 0xa7db, 0xb7fa, 0x8799, 0x97b8,
        0xe75f, 0xf77e, 0xc71d, 0xd73c, 0x26d3, 0x36f2,
        0x0691, 0x16b0, 0x6657, 0x7676, 0x4615, 0x5634,
        0xd94c, 0xc96d, 0xf90e, 0xe92f, 0x99c8, 0x89e9,
        0xb98a, 0xa9ab, 0x5844, 0x4865, 0x7806, 0x6827,
        0x18c0, 0x08e1, 0x3882, 0x28a3, 0xcb7d, 0xdb5c,
        0xeb3f, 0xfb1e, 0x8bf9, 0x9bd8, 0xabbb, 0xbb9a,
        0x4a75, 0x5a54, 0x6a37, 0x7a16, 0x0af1, 0x1ad0,
        0x2ab3, 0x3a92, 0xfd2e, 0xed0f, 0xdd6c, 0xcd4d,
        0xbdaa, 0xad8b, 0x9de8, 0x8dc9, 0x7c26, 0x6c07,
        0x5c64, 0x4c45, 0x3ca2, 0x2c83, 0x1ce0, 0x0cc1,
        0xef1f, 0xff3e, 0xcf5d, 0xdf7c, 0xaf9b, 0xbfba,
        0x8fd9, 0x9ff8, 0x6e17, 0x7e36, 0x4e55, 0x5e74,
        0x2e93, 0x3eb2, 0x0ed1, 0x1ef0];

    function crc16(s) {
        var crc = 0xFFFF;
        var j, i;

        for (i = 0; i < s.length; i++) {

            c = s.charCodeAt(i);
            if (c > 255) {
                throw new RangeError();
            }
            j = (c ^ (crc >> 8)) & 0xFF;
            crc = crcTable[j] ^ (crc << 8);
        }

        return ((crc ^ 0) & 0xFFFF).toString(16).toUpperCase();
    }
}
