# ListRecordsResponse


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**records** | [**List[DnsRecord]**](DnsRecord.md) |  | 

## Example

```python
from freestyle_client.models.list_records_response import ListRecordsResponse

# TODO update the JSON string below
json = "{}"
# create an instance of ListRecordsResponse from a JSON string
list_records_response_instance = ListRecordsResponse.from_json(json)
# print the JSON string representation of the object
print(ListRecordsResponse.to_json())

# convert the object into a dict
list_records_response_dict = list_records_response_instance.to_dict()
# create an instance of ListRecordsResponse from a dict
list_records_response_from_dict = ListRecordsResponse.from_dict(list_records_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


