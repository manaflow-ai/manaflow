# DnsRecordData


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**kind** | [**DnsRecordKind**](DnsRecordKind.md) |  | 
**name** | **str** |  | 
**value** | **str** |  | 
**ttl** | **str** |  | [optional] 
**priority** | **int** |  | [optional] 

## Example

```python
from freestyle_client.models.dns_record_data import DnsRecordData

# TODO update the JSON string below
json = "{}"
# create an instance of DnsRecordData from a JSON string
dns_record_data_instance = DnsRecordData.from_json(json)
# print the JSON string representation of the object
print(DnsRecordData.to_json())

# convert the object into a dict
dns_record_data_dict = dns_record_data_instance.to_dict()
# create an instance of DnsRecordData from a dict
dns_record_data_from_dict = DnsRecordData.from_dict(dns_record_data_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


