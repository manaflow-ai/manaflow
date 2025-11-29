# CreateRecordResponse


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**record** | [**DnsRecord**](DnsRecord.md) |  | 

## Example

```python
from freestyle_client.models.create_record_response import CreateRecordResponse

# TODO update the JSON string below
json = "{}"
# create an instance of CreateRecordResponse from a JSON string
create_record_response_instance = CreateRecordResponse.from_json(json)
# print the JSON string representation of the object
print(CreateRecordResponse.to_json())

# convert the object into a dict
create_record_response_dict = create_record_response_instance.to_dict()
# create an instance of CreateRecordResponse from a dict
create_record_response_from_dict = CreateRecordResponse.from_dict(create_record_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


